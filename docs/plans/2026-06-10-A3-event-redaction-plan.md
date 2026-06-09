# Track A3 — Redact the Data Plane + Broaden Patterns — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop secrets/PII from landing in the persisted event store (finding **F-C3**). Today `redact()` is wired into the audit path ONLY — the VINES event store commits raw user `input` / model `final`, and the matcher only catches `sk-`/`Bearer`. This (1) broadens `redact()` to real provider key shapes + JWT/PEM + email PII, and (2) applies redaction at the **event-store boundary** via a `RedactingEventStore` decorator wired into `buildAgentRun` — so every persisted event (in-memory or durable) is redacted, while structural fields needed for replay (`sessionId`, `runId`, `type`, `phase`, `at`) are preserved.

**Architecture:** `redact()` gains provider/value patterns and a few more secret key-names (carefully — NOT `session`/`id`/bare `key`, which would corrupt replay). A `RedactingEventStore` (`packages/core/src/session/redacting-store.ts`) wraps any `EventStore`: `append` redacts the event then delegates; `read` passes through. `buildAgentRun` wraps the (injected-or-default) store with it. Redaction is value-shape + secret-key-name based, so it never touches `sessionId`/`phase`/`type` (those don't match), keeping `read(sessionId)` and `foldPlaybook` intact.

**Tech Stack:** TypeScript strict, ESM `.js` specifiers, Vitest, Node 24 + Bun 1.3. Prettier printWidth 100, double quotes.

**Review basis:** [`docs/reviews/2026-06-09-production-readiness-review.md`](../reviews/2026-06-09-production-readiness-review.md) — **A3 / F-C3**.

**Depends on (merged):** `packages/core/src/security/redact.ts` (`redact`, `REDACTED`); `packages/core/src/session/events.ts` (`EventStore`, `DomainEvent`, `InMemoryEventStore`); `packages/core/src/playbook/build-agent-run.ts` (`buildAgentRun`, wraps the store); the durable path (`buildDurableAgentRun` in state) injects a `SqliteEventStore` which `buildAgentRun` will now wrap.

**Conventions:** Coverage ≥99%; new src files 100%. Redaction must NOT change structural event fields — verify `read(sessionId)` and replay still work (the durable A1 integration test must stay green).

---

### Task 1: Broaden `redact()` patterns

**Files:**

- Modify: `packages/core/src/security/redact.ts`
- Test: `packages/core/test/security/redact.test.ts`

- [ ] **Step 1: Write/extend the tests.** READ `packages/core/test/security/redact.test.ts` (create if absent). ADD cases asserting these are redacted in a STRING value, and that benign structural values are NOT:

```ts
import { redact, REDACTED } from "../../src/security/redact.js";

describe("redact — broadened patterns", () => {
  const masked = (s: string) => redact(s) as string;

  it("masks real provider key shapes inside a string", () => {
    // Build each value from low-entropy repeated chars so the source has no contiguous
    // high-entropy secret literal (GitHub push protection flags those even as fixtures).
    const body = (n: number, ch = "a") => ch.repeat(n);
    expect(masked(`x AKIA${body(16, "A")} y`)).toContain(REDACTED); // AWS
    expect(masked(`x AIza${body(35)} y`)).toContain(REDACTED); // Google
    expect(masked(`x ghp_${body(36)} y`)).toContain(REDACTED); // GitHub
    expect(masked(`x github_pat_${body(30)} y`)).toContain(REDACTED); // GitHub PAT
    expect(masked(`x sk_live_${body(20)} y`)).toContain(REDACTED); // Stripe
    expect(masked(`x xoxb-${body(20, "0")} y`)).toContain(REDACTED); // Slack
    expect(masked(`x eyJ${body(8)}.${body(8, "b")}.${body(8, "c")} y`)).toContain(REDACTED); // JWT
  });

  it("masks a PEM private key block", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIabc123\n-----END RSA PRIVATE KEY-----";
    expect(masked(`x ${pem} y`)).toContain(REDACTED);
    expect(masked(`x ${pem} y`)).not.toContain("MIIabc123");
  });

  it("masks an email (PII)", () => {
    expect(masked("contact jane.doe@example.com please")).toContain(REDACTED);
    expect(masked("contact jane.doe@example.com please")).not.toContain("jane.doe@example.com");
  });

  it("redacts broadened secret KEY names", () => {
    const out = redact({
      client_secret: "x",
      access_token: "y",
      pwd: "z",
      credential: "c",
    }) as Record<string, unknown>;
    expect(out).toEqual({
      client_secret: REDACTED,
      access_token: REDACTED,
      pwd: REDACTED,
      credential: REDACTED,
    });
  });

  it("does NOT redact structural fields (replay safety)", () => {
    // sessionId/runId/phase/type/at must survive — they are needed to read + replay.
    const ev = {
      type: "PhaseEntered",
      sessionId: "probe-agent-session",
      runId: "r1",
      phase: "Validate",
      at: 5,
    };
    expect(redact(ev)).toEqual(ev);
  });

  it("keeps the original sk-/Bearer behavior", () => {
    expect(masked("sk-abcdefgh12345")).toContain(REDACTED);
    expect(masked("Bearer abc.def")).toContain(REDACTED);
  });
});
```

- [ ] **Step 2: Run → fail** (new shapes not matched yet).

- [ ] **Step 3: Edit `packages/core/src/security/redact.ts`.** Broaden the two matchers. Keep the recursion/structure exactly; only change the regexes:

```ts
// Field names whose values are secrets regardless of content. Deliberately NARROW —
// must NOT match structural fields the runtime needs (session/id/type/phase/at).
const SECRET_KEY =
  /(secret|token|api[-_]?key|password|passphrase|passwd|pwd|authorization|bearer|credential|private[-_]?key|access[-_]?token|client[-_]?secret|cookie)/i;

// Value shapes that are secrets/PII regardless of field name. Each is applied globally.
const SECRET_VALUES: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI-style
  /Bearer\s+\S+/g,
  /(AKIA|ASIA)[A-Z0-9]{16}/g, // AWS access key id
  /AIza[A-Za-z0-9_-]{35}/g, // Google API key
  /gh[posru]_[A-Za-z0-9]{36}/g, // GitHub token
  /github_pat_[A-Za-z0-9_]{22,}/g, // GitHub fine-grained PAT
  /(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g, // Stripe
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g, // PEM
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email PII
];

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_VALUES.reduce((s, re) => s.replace(re, REDACTED), value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}
```

Update the file's doc comment to mention provider-key shapes + PEM/JWT/email PII and the deliberate narrowness of key-name matching (no session/id/type).

- [ ] **Step 4: Run → pass + 100% coverage** of `redact.ts`.

- [ ] **Step 5: Gates + `npx tsc -b packages/core`.** Clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/security/redact.ts packages/core/test/security/redact.test.ts
git commit -m "feat(security): broaden redact() — provider keys, JWT/PEM, email PII (F-C3)"
```

---

### Task 2: `RedactingEventStore` decorator + wire into `buildAgentRun`

**Files:**

- Create: `packages/core/src/session/redacting-store.ts`
- Modify: `packages/core/src/session/events.ts`? (no — keep the decorator separate) → export via the core barrel from its own file; add to `packages/core/src/index.ts`
- Modify: `packages/core/src/playbook/build-agent-run.ts` (wrap the store)
- Test: `packages/core/test/session/redacting-store.test.ts`
- Modify: `packages/core/test/playbook/build-agent-run.test.ts` (update the injected-store-identity assertion)

- [ ] **Step 1: Write the failing test** — `packages/core/test/session/redacting-store.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RedactingEventStore } from "../../src/session/redacting-store.js";
import { InMemoryEventStore, type DomainEvent } from "../../src/session/events.js";

describe("RedactingEventStore", () => {
  it("redacts secret-shaped event payload fields on append; reads them back redacted", async () => {
    const inner = new InMemoryEventStore();
    const store = new RedactingEventStore(inner);
    await store.append({
      type: "TurnStarted",
      sessionId: "s1",
      turnId: "t1",
      input: "my key is sk-abcdefgh12345 ok",
      at: 1,
    } as DomainEvent);
    const [ev] = await store.read("s1");
    expect(JSON.stringify(ev)).not.toContain("sk-abcdefgh12345");
    // structural fields survive (so read + replay work)
    expect((ev as { sessionId: string }).sessionId).toBe("s1");
    expect((ev as { type: string }).type).toBe("TurnStarted");
  });

  it("read passes through and preserves order + sessionId filtering", async () => {
    const store = new RedactingEventStore(new InMemoryEventStore());
    await store.append({
      type: "SessionStarted",
      sessionId: "a",
      agentId: "x",
      at: 1,
    } as DomainEvent);
    await store.append({
      type: "SessionStarted",
      sessionId: "b",
      agentId: "y",
      at: 2,
    } as DomainEvent);
    expect((await store.read("a")).length).toBe(1);
    expect((await store.read("b")).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run → fail** (cannot find module).

- [ ] **Step 3: Write `packages/core/src/session/redacting-store.ts`:**

```ts
import type { EventStore, DomainEvent } from "./events.js";
import { redact } from "../security/redact.js";

/**
 * Wraps an `EventStore` so every appended event is redacted at the persistence boundary
 * (review F-C3): secrets/PII in payload fields (e.g. a user prompt's `input`, a model
 * `final`) never land in the durable store. `redact` masks by value-shape + secret
 * key-name only, so structural fields (`sessionId`, `runId`, `type`, `phase`, `at`)
 * survive — `read`/replay are unaffected. `read` is a pure pass-through.
 */
export class RedactingEventStore implements EventStore {
  constructor(private readonly inner: EventStore) {}

  async append(event: DomainEvent): Promise<void> {
    await this.inner.append(redact(event) as DomainEvent);
  }

  async read(sessionId: string): Promise<DomainEvent[]> {
    return this.inner.read(sessionId);
  }
}
```

- [ ] **Step 3b: Export it** — add to `packages/core/src/index.ts`: `export * from "./session/redacting-store.js";` (find where session exports are; the index re-exports `session/*` — verify `redacting-store` is included, add the line if not).

- [ ] **Step 3c: Wrap in `buildAgentRun`.** In `packages/core/src/playbook/build-agent-run.ts`, import `RedactingEventStore` and wrap the resolved store:

```ts
const baseStore = opts.store ?? new InMemoryEventStore();
const store = new RedactingEventStore(baseStore);
```

Use `store` everywhere the prior `store` was used (Agent.start, PlaybookRun.start, and the returned `BuiltAgentRun.store`). The returned `store` is the redacting wrapper (its `read` passes through to the injected store).

- [ ] **Step 3d: Update the A1 injected-store test.** The test `"uses injected store + audit when provided"` currently asserts `expect(built.store).toBe(store)`. Since the store is now wrapped, change that assertion to verify the injected store is USED (events land in it) rather than identity:

```ts
// the injected store is wrapped for redaction, but events DO land in it:
expect(built.store).toBeInstanceOf(RedactingEventStore);
await built.run.run();
expect((await store.read("probe-agent-session")).length).toBeGreaterThan(0);
expect(built.audit).toBe(audit); // audit is still injected as-is (it redacts internally)
```

(Import `RedactingEventStore` in that test. Keep the `prompts: {}` so no agent turn is needed for the construction part, but this assertion runs the loop — ensure the operator approves; reuse the file's `approve()` helper if the run needs it. If running is awkward, instead assert `built.store` wraps `store` by appending an event through `built.store` and reading it from `store`.)

- [ ] **Step 4: Run → pass + 100% coverage** of `redacting-store.ts` and `build-agent-run.ts`:
      `npx vitest run packages/core/test/session/redacting-store.test.ts packages/core/test/playbook/build-agent-run.test.ts --coverage.enabled --coverage.include='packages/core/src/session/redacting-store.ts' --coverage.include='packages/core/src/playbook/build-agent-run.ts'` — all PASS, 100%.

- [ ] **Step 5: Gates + `npm run build`.** Clean (the durable A1 integration test + system-e2e must still pass — redaction is a no-op on their benign payloads).

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/session/redacting-store.ts packages/core/src/index.ts packages/core/src/playbook/build-agent-run.ts packages/core/test/session/redacting-store.test.ts packages/core/test/playbook/build-agent-run.test.ts
git commit -m "feat(session): RedactingEventStore — redact events at the persistence boundary (F-C3)"
```

---

### Task 3: End-to-end "planted secret never persists" test + full gate

**Files:**

- Test: `packages/core/test/playbook/system-e2e.test.ts` (add a case) — OR a new focused test in `packages/core/test/playbook/`.

- [ ] **Step 1: Add the test.** Append to `packages/core/test/playbook/system-e2e.test.ts` a case that plants a secret in the Execute prompt and asserts it appears nowhere in the persisted events or audit:

```ts
it("a secret planted in a prompt never lands in the event store or audit (F-C3)", async () => {
  const SECRET = "sk-PLANTEDsecret123456";
  const built = await buildAgentRun({
    adapter: multiTurnWeakModel(tmpdir(), 1),
    grounding: "cited",
    prompts: { Execute: `remember my key ${SECRET}` },
    operator: approvals(8),
    validateGate: new ValidateGate(async () => ({ ok: true })),
  });
  await built.run.run();
  const events = JSON.stringify(await built.store.read("probe-agent-session"));
  const audit = JSON.stringify(await built.audit.entries());
  expect(events).not.toContain(SECRET);
  expect(audit).not.toContain(SECRET);
});
```

(Adapt helper names — `multiTurnWeakModel`, `approvals`, `tmpdir`, `buildAgentRun`, `ValidateGate` — to whatever the file already defines/imports. The scripted model echoes the input into its hallucination/answer, so the secret would flow into `input` AND `final` events without redaction — this proves both are masked.)

- [ ] **Step 2: Run → pass.** `npx vitest run packages/core/test/playbook/system-e2e.test.ts`.

- [ ] **Step 3: Full repo gate.**
      `npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional` — all green; aggregate ≥99%; `redact.ts` + `redacting-store.ts` 100%. Paste the coverage tail.

- [ ] **Step 4: Docker gate.** `docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test` → `✅ ALL GATES PASSED`.

- [ ] **Step 5: Roadmap.** Mark **A3** done in `docs/reviews/2026-06-09-production-readiness-review.md` §3 (`3. **A3 — … (F-C3) ✅ DONE (PR pending).** …`). Note the residual: redaction is pattern-based (recognizable shapes + email); generic high-entropy/other-PII detection is future work.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/test/playbook/system-e2e.test.ts docs/reviews/2026-06-09-production-readiness-review.md
git commit -m "test(playbook): planted secret never persists (F-C3); mark A3 done"
```

---

## Self-Review (coverage of the A3 scope)

- **F-C3 — broadened redaction:** provider keys + JWT/PEM/email (Task 1). ✓
- **F-C3 — data-plane redaction:** `RedactingEventStore` at the event-store boundary, wired into `buildAgentRun` (Task 2); planted-secret e2e proves events + audit are clean (Task 3). ✓
- **Replay safety:** `redact` matches only value-shapes + narrow secret key-names — `sessionId`/`runId`/`type`/`phase`/`at` survive, so `read(sessionId)`/`foldPlaybook` and the durable A1 integration test stay green (verified by the full gate). ✓
- **No over-redaction:** key-name matcher deliberately excludes `session`/`id`/bare `key`. ✓
- **Type consistency:** `RedactingEventStore`, `redact`/`REDACTED` reused; `buildAgentRun` returns the wrapper as `store`. ✓

## Next (Track A continues)

A4 (adapter hardening — JSON guard + timeouts/retries, F-C4/F-H1/F-M4) — the last code-level Critical. Then A5–A8, A2b/A2c, and Track B.
