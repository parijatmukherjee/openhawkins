# Zero-Flaw Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 24 open items from the architecture assessment (P0–P3) to reach **ZERO flaws, ZERO bugs**.

**Architecture:** Five P0 items are critical runtime gaps; five P1 items are boundary hardening; four P2 items are observability/scale; ten P3 items are operational polish. All must pass the full gate (build · lint · format:check · coverage ≥99% · unit · functional · Docker).

**Tech Stack:** TypeScript (strict ESM, `.js` specifiers), Vitest, Zod, SQLite, Bun/Node dual-runtime.

---

## File Structure

- `packages/core/src/session/events.ts` — `EventStore` interface: add `read` pagination
- `packages/state/src/event-store.ts` — `SqliteEventStore.read()`: implement `LIMIT` + cursor
- `packages/core/src/session/replay.ts` — `rebuildState`: use streaming fold
- `packages/core/src/security/capability.ts` — `grantSatisfies`: enforce scope (deny-by-default)
- `packages/core/src/bin/ask.ts` — read adapter keys from Vault, not `process.env`
- `packages/core/src/eval/scenarios.ts` — `buildProbeAgent`: accept logger + markdownify + memory
- `packages/core/src/eval/agent.ts` — `AgentConfig`: add markdownify + memory options
- `packages/core/src/loop/agent-loop.ts` — `AgentLoopConfig`: add memory injection
- `packages/markdownify/src/registry.ts` — `ConverterRegistry`: accept logger sink
- `packages/core/src/tools/tool.ts` — add `DocumentTool` definition
- `packages/core/src/os/platform.ts` — `runCommand`: add execution timeout
- `packages/core/src/playbook/gate-command.ts` — gate spawn: add timeout
- `packages/core/src/observability/logger.ts` — add traceId/correlation ID support
- `packages/core/src/observability/metrics.ts` — new: `Metrics` interface + `NoopMetrics`
- `packages/state/src/bin/openhawkins-run.ts` — add `--health` flag

---

## Phase 0: Foundation (merge PR #28, sync main)

- [x] **Step 0: Merge PR #28** ✅ DONE

---

## Phase 1: P0 — Critical Runtime Gaps

### Task 1: Add LIMIT + cursor to EventStore.read() (OOM fix)

**Files:**

- Modify: `packages/core/src/session/events.ts`
- Modify: `packages/state/src/event-store.ts`
- Modify: `packages/core/src/session/replay.ts`
- Modify: `packages/core/src/session/session.ts`
- Test: `packages/core/test/session/events.test.ts`, `packages/state/test/event-store.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it("reads events in paginated chunks", async () => {
  const store = new InMemoryEventStore();
  for (let i = 0; i < 5; i++) {
    await store.append({
      type: "TurnStarted",
      sessionId: "s1",
      turnId: `t${i}`,
      input: "x",
      at: i,
    });
  }
  const chunk1 = await store.read("s1", { limit: 2 });
  expect(chunk1).toHaveLength(2);
  const chunk2 = await store.read("s1", { limit: 2, afterSeq: (chunk1[1] as any).seq });
  expect(chunk2).toHaveLength(2);
  const chunk3 = await store.read("s1", { limit: 2, afterSeq: (chunk2[1] as any).seq });
  expect(chunk3).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Add pagination to EventStore interface + implementations**

Change `EventStore.read` signature:

```ts
read(sessionId: string, opts?: { limit?: number; afterSeq?: number }): Promise<DomainEvent[]>;
```

Add `seq` auto-increment to `DomainEvent` (or derive from order).

- [ ] **Step 4: Update replay.ts to use streaming fold**

```ts
export async function rebuildState(store: EventStore, sessionId: string): Promise<SessionState> {
  let state = initialState();
  let afterSeq: number | undefined;
  while (true) {
    const chunk = await store.read(sessionId, { limit: 1000, afterSeq });
    if (chunk.length === 0) break;
    for (const event of chunk) {
      state = reduceEvent(state, event);
      afterSeq = (event as any).seq;
    }
    if (chunk.length < 1000) break;
  }
  return state;
}
```

- [ ] **Step 5: Run tests, build, prettier, commit**

---

### Task 2: Enforce capability scope (deny-by-default)

**Files:**

- Modify: `packages/core/src/security/capability.ts`
- Test: `packages/core/test/security/capability.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it("rejects a scoped grant for a scopeless requirement (deny-by-default)", () => {
  const grant = { agentId: "a", capabilities: [{ name: "fs:read", scope: "/tmp" }] };
  expect(grantSatisfies(grant, { name: "fs:read" })).toBe(false);
});
```

- [ ] **Step 2: Update grantSatisfies**

```ts
export function grantSatisfies(grant: AgentGrant, required: Capability): boolean {
  return grant.capabilities.some((c) => {
    if (c.name !== required.name) return false;
    // Deny-by-default: a scopeless requirement matches only a scopeless grant.
    // A scoped requirement matches only if the grant's scope is a prefix of the required scope.
    if (required.scope === undefined) {
      return c.scope === undefined; // scopeless requirement → scopeless grant only
    }
    if (c.scope === undefined) {
      return true; // broad grant satisfies any scoped requirement
    }
    return required.scope.startsWith(c.scope);
  });
}
```

- [ ] **Step 3: Run tests, build, prettier, commit**

---

### Task 3: Wire adapter keys through Vault in CLI

**Files:**

- Modify: `packages/core/src/bin/ask.ts`
- Modify: `packages/state/src/bin/openhawkins-run.ts`
- Test: `packages/core/test/bin/ask.test.ts` (new)

- [ ] **Step 1: Add Vault-resolved key loading to ask.ts**

```ts
import { FileVault } from "../security/vault.js";

async function buildAdapter(kind: string, path: string, vault?: FileVault): Promise<ModelAdapter> {
  // ...existing cases, but read from vault if available
  if (kind === "ollama" && vault) {
    const model =
      (await vault.get("ollama-model")) ?? process.env.OPENHAWKINS_OLLAMA_MODEL ?? "llama3.1";
    // ...
  }
}
```

- [ ] **Step 2: Add `--vault` and `--passphrase` flags to ask.ts**

- [ ] **Step 3: Run tests, build, prettier, commit**

---

### Task 4: Wire markdownify into agent path

**Files:**

- Modify: `packages/core/src/eval/agent.ts`
- Modify: `packages/core/src/eval/scenarios.ts`
- Modify: `packages/core/src/loop/agent-loop.ts`
- Create: `packages/core/src/tools/document-tool.ts`
- Test: `packages/core/test/eval/agent.test.ts`

- [ ] **Step 1: Create DocumentTool**

```ts
import { ConverterRegistry } from "@openhawkins/markdownify";

export const documentTool: ToolDefinition<
  { data: string; mime?: string; filename?: string },
  { markdown: string; format: string }
> = {
  name: "convert_document",
  description: "Convert a document (CSV, HTML, JSON, XML, text) to Markdown for token reduction.",
  capabilities: [{ name: "document:convert" }],
  args: z.object({
    data: z.string(),
    mime: z.string().optional(),
    filename: z.string().optional(),
  }),
  handler: async (args) => {
    const reg = new ConverterRegistry();
    const result = await reg.convert({ data: args.data, mime: args.mime, filename: args.filename });
    return { markdown: result.markdown, format: result.format };
  },
};
```

- [ ] **Step 2: Add markdownify to AgentConfig + buildProbeAgent**

- [ ] **Step 3: Run tests, build, prettier, commit**

---

### Task 5: Wire memory (VECNA) into agent path

**Files:**

- Modify: `packages/core/src/eval/agent.ts`
- Modify: `packages/core/src/eval/scenarios.ts`
- Modify: `packages/core/src/loop/agent-loop.ts`
- Test: `packages/core/test/eval/agent.test.ts`

- [ ] **Step 1: Add memory injection to AgentLoopConfig**

```ts
export interface AgentLoopConfig {
  // ...existing fields
  /** Optional memory store for context injection before each turn. */
  memory?: { recall(query: string): Promise<string[]> };
}
```

- [ ] **Step 2: Inject recalled fragments into system prompt**

```ts
if (cfg.memory) {
  const fragments = await cfg.memory.recall(input);
  if (fragments.length > 0) {
    const memoryPrompt = `Relevant context:\n${fragments.join("\n")}`;
    systemPrompt = systemPrompt ? `${memoryPrompt}\n\n${systemPrompt}` : memoryPrompt;
  }
}
```

- [ ] **Step 3: Run tests, build, prettier, commit**

---

## Phase 2: P1 — Boundary Hardening

### Task 6: Bound runCommand/gate-spawn execution time

**Files:**

- Modify: `packages/core/src/os/platform.ts`
- Modify: `packages/core/src/playbook/gate-command.ts`
- Test: `packages/core/test/os/platform.test.ts`

- [ ] **Step 1: Add timeout to runCommand**

```ts
export async function runCommand(
  cmd: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ stdout: string; stderr: string }> {
  // Use AbortController or child_process.kill on deadline
}
```

- [ ] **Step 2: Wire timeout into gate-command spawn**

- [ ] **Step 3: Run tests, build, prettier, commit**

---

### Task 7: Instrument markdownify + probe agent with logger

**Files:**

- Modify: `packages/markdownify/src/registry.ts`
- Modify: `packages/core/src/eval/scenarios.ts`
- Modify: `packages/core/src/eval/agent.ts`
- Test: `packages/markdownify/test/registry.test.ts`

- [ ] **Step 1: Add logger to ConverterRegistry constructor**

- [ ] **Step 2: Log warnings at degrade-to-fallback points**

- [ ] **Step 3: Thread logger through buildProbeAgent**

- [ ] **Step 4: Run tests, build, prettier, commit**

---

### Task 8: Stress-test real adapter failures

**Files:**

- Create: `packages/core/test/models/adapter-stress.test.ts`
- Modify: `packages/core/src/models/http.ts` (if needed)

- [ ] **Step 1: Write tests with misbehaving HTTP server**

```ts
it("handles 200 OK with HTML body (gateway/captcha)", async () => { ... });
it("handles ECONNRESET mid-request", async () => { ... });
it("handles 429 with Retry-After header", async () => { ... });
it("handles 502 Bad Gateway", async () => { ... });
```

- [ ] **Step 2: Run tests, build, prettier, commit**

---

### Task 9: Add health/readiness probe

**Files:**

- Modify: `packages/state/src/bin/openhawkins-run.ts`
- Create: `packages/state/src/health.ts`
- Test: `packages/state/test/health.test.ts`

- [ ] **Step 1: Add `--health` CLI flag**

```ts
if (args.includes("--health")) {
  const report = await healthCheck({ db, vault, audit });
  console.log(JSON.stringify(report));
  process.exit(report.healthy ? 0 : 1);
}
```

- [ ] **Step 2: Implement health check**

- [ ] **Step 3: Run tests, build, prettier, commit**

---

### Task 10: Add correlation IDs to logs

**Files:**

- Modify: `packages/core/src/observability/logger.ts`
- Modify: `packages/core/src/eval/agent.ts`
- Modify: `packages/core/src/loop/agent-loop.ts`
- Test: `packages/core/test/observability/logger.test.ts`

- [ ] **Step 1: Add traceId to Logger interface**

```ts
export interface Logger {
  log(level: LogLevel, event: string, fields?: Record<string, unknown>, traceId?: string): void;
}
```

- [ ] **Step 2: Generate traceId per turn and propagate**

- [ ] **Step 3: Run tests, build, prettier, commit**

---

## Phase 3: P2 — Observability & Scale

### Task 11: Add metrics/telemetry

**Files:**

- Create: `packages/core/src/observability/metrics.ts`
- Modify: `packages/core/src/loop/agent-loop.ts`
- Modify: `packages/core/src/eval/agent.ts`
- Test: `packages/core/test/observability/metrics.test.ts`

- [ ] **Step 1: Define Metrics interface**

```ts
export interface Metrics {
  counter(name: string, labels?: Record<string, string>): void;
  histogram(name: string, value: number, labels?: Record<string, string>): void;
  gauge(name: string, value: number, labels?: Record<string, string>): void;
}
```

- [ ] **Step 2: Wire into agent loop**

- [ ] **Step 3: Run tests, build, prettier, commit**

---

### Task 12: External audit anchoring (A2b)

**Files:**

- Create: `packages/core/src/security/anchor.ts`
- Test: `packages/core/test/security/anchor.test.ts`

- [ ] **Step 1: Implement anchor interface**

```ts
export interface AuditAnchor {
  publish(headHash: string, seq: number): Promise<void>;
}
```

- [ ] **Step 2: Add to SqliteAuditLog**

- [ ] **Step 3: Run tests, build, prettier, commit**

---

### Task 13: Audit verify diagnostics + key rotation (A2c)

**Files:**

- Modify: `packages/core/src/security/audit.ts`
- Modify: `packages/state/src/audit-store.ts`
- Test: `packages/core/test/security/audit.test.ts`

- [ ] **Step 1: Add richer verify result**

```ts
export interface VerifyResult {
  ok: boolean;
  reason?: "tampered" | "wrong-key" | "empty";
  firstBadSeq?: number;
}
```

- [ ] **Step 2: Add per-entry keyId**

- [ ] **Step 3: Run tests, build, prettier, commit**

---

## Phase 4: P3 — Operational Polish

### Task 14: Backup/restore docs, log rotation, service defs, Windows CI, VACUUM, fuzz tests, rollback, backpressure, barrel export

**Files:**

- Create: `docs/ops/backup-restore.md`
- Create: `docs/ops/systemd.service`
- Create: `.github/workflows/ci.yml` (or verify existing)
- Modify: `packages/state/src/driver/driver.ts` (VACUUM)
- Modify: `packages/state/src/migrate.ts` (rollback)
- Modify: `packages/core/src/index.ts` (barrel export)
- Create: `packages/core/test/security/redact-fuzz.test.ts`

---

## Phase 5: Final Gate

- [ ] **Step 1: Full repo gate**

```bash
npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional
```

- [ ] **Step 2: Docker gate**

```bash
docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test
```

- [ ] **Step 3: Update CHECKPOINT.md and architecture assessment**

- [ ] **Step 4: Commit all docs updates**

---

## Summary

| Phase     | Tasks                   | Status   |
| --------- | ----------------------- | -------- |
| P0        | 5 critical runtime gaps | 🔴 OPEN  |
| P1        | 5 boundary hardening    | 🔴 OPEN  |
| P2        | 4 observability/scale   | 🔴 OPEN  |
| P3        | 10 operational polish   | 🔴 OPEN  |
| **Total** | **24**                  | **0/24** |

**Target: 24/24 ✅ (ZERO flaws, ZERO bugs)**
