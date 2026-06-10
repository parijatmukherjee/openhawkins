# A7 — Observability (F-M1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the runtime a structured logger and emit at the live "never-throws" swallow points so silent degradations (capability denials, swallowed tool exceptions, gate-predicate throws) become diagnosable — closing review finding **F-M1**.

**Architecture:** A dependency-free structured logger (no pino/native addons — the single-binary path must run on Node and Bun). A narrow `Logger` interface (`log(level, event, fields?)`) is depended on by the components; the default is a shared `noopLogger` (library and tests stay silent unless a composition root injects a real one), and production wires a `JsonLogger` that emits one JSON object per event to a sink (default: a line to stderr). Log fields are run through the existing `redact()` (A3) before emit, so a secret swept into a log payload never lands in the log — the F-C3 guarantee extends to the log plane. Components get an injected `logger` (DI), threaded through the `buildAgentRun` composition root and turned on in the CLIs.

**Scope (honest):** This closes F-M1 at the **wired** swallow points — `ToolRegistry.invoke` (capability denial, confused-deputy agent mismatch, swallowed handler exception) and `ValidateGate.evaluate` (predicate throw). The markdownify `ConverterRegistry` degrade-to-fallback warnings are a named swallow point too, but markdownify is not yet wired into the agent path (review F-H6) and has no composition root to inject a logger, so its instrumentation is deferred to when markdownify is wired (tracked as **A7b**). markdownify must not import `core` (it is a lower layer), so when it is wired it will take a structural log-sink, not core's `Logger` type.

**Tech Stack:** TypeScript (strict ESM, `.js` specifiers), `node:process` stderr, Vitest.

---

## File Structure

- `packages/core/src/observability/logger.ts` — `LogLevel`, `LogFields`, `Logger`, `noopLogger`, `JsonLogger`.
- `packages/core/src/index.ts` — re-export the above so `@openhawkins/core` consumers (state CLI) and the core CLIs can construct a `JsonLogger`.
- `packages/core/src/tools/registry.ts` — `ToolRegistry` takes an injected `logger`; emits at its swallow points.
- `packages/core/src/playbook/gates.ts` — `ValidateGate` takes an injected `logger`; emits on predicate throw.
- `packages/core/src/playbook/build-agent-run.ts` — accept `logger?`, thread into the registry + default gate.
- `packages/core/src/bin/ask.ts`, `bin/run.ts`, `packages/state/src/bin/openhawkins-run.ts` — construct a `JsonLogger` and pass it (turns logging ON in the runnable entrypoints).
- Tests: `packages/core/test/observability/logger.test.ts`; emission assertions added to `test/tools/registry.test.ts`, `test/playbook/gates.test.ts`, `test/playbook/build-agent-run.test.ts`.

---

### Task 1: The logger module

**Files:**

- Create: `packages/core/src/observability/logger.ts`
- Create: `packages/core/test/observability/logger.test.ts`

- [ ] **Step 1: Write the failing tests (RED)**

Create `packages/core/test/observability/logger.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { JsonLogger, noopLogger, type LogLevel } from "../../src/observability/logger.js";
import { REDACTED } from "../../src/security/redact.js";

describe("noopLogger", () => {
  it("accepts a call and does nothing (no throw, no output)", () => {
    expect(() => noopLogger.log("error", "anything", { a: 1 })).not.toThrow();
  });
});

describe("JsonLogger", () => {
  const sink = () => {
    const lines: string[] = [];
    return { write: (l: string) => lines.push(l), lines };
  };

  it("emits one JSON object per event with level, event, and fields", () => {
    const s = sink();
    new JsonLogger({ sink: s.write }).log("info", "hello", { n: 1 });
    expect(s.lines).toHaveLength(1);
    expect(JSON.parse(s.lines[0])).toEqual({ level: "info", event: "hello", n: 1 });
  });

  it("merges base fields into every record", () => {
    const s = sink();
    new JsonLogger({ sink: s.write, base: { runId: "r1" } }).log("warn", "e");
    expect(JSON.parse(s.lines[0])).toEqual({ level: "warn", event: "e", runId: "r1" });
  });

  it("drops records below the minimum level", () => {
    const s = sink();
    const log = new JsonLogger({ sink: s.write, min: "warn" });
    log.log("info", "quiet");
    log.log("error", "loud");
    expect(s.lines.map((l) => (JSON.parse(l) as { event: string }).event)).toEqual(["loud"]);
  });

  it("redacts secrets in fields before emit", () => {
    const s = sink();
    new JsonLogger({ sink: s.write }).log("error", "boom", { apiKey: "sk-supersecret-123" });
    expect(s.lines[0]).not.toContain("sk-supersecret-123");
    expect((JSON.parse(s.lines[0]) as { apiKey: string }).apiKey).toBe(REDACTED);
  });

  it("defaults to writing a newline-terminated line to stderr at >=info", () => {
    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      new JsonLogger().log("info", "viastderr");
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0][0]).toBe(
        `${JSON.stringify({ level: "info", event: "viastderr" })}\n`,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("the default minimum is info (debug is dropped)", () => {
    const s = sink();
    const log = new JsonLogger({ sink: s.write });
    log.log("debug", "trace");
    expect(s.lines).toHaveLength(0);
  });

  it("orders levels debug < info < warn < error", () => {
    const order: LogLevel[] = ["debug", "info", "warn", "error"];
    const s = sink();
    const log = new JsonLogger({ sink: s.write, min: "debug" });
    for (const lvl of order) log.log(lvl, lvl);
    expect(s.lines).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run logger.test.ts`
Expected: FAIL — the module does not exist yet.

- [ ] **Step 3: Implement `packages/core/src/observability/logger.ts`**

```ts
import { redact } from "../security/redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

/** A structured sink: one method, one event at a time. Components depend on this narrow
 *  interface (not a concrete logger), so tests inject a capturing logger and production
 *  injects the JSON-to-stderr one. */
export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
}

/** The default: drops everything. Library and test constructions stay silent unless a
 *  composition root injects a real logger. */
export const noopLogger: Logger = { log() {} };

const SEVERITY: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export interface JsonLoggerOptions {
  /** Minimum level to emit (default "info"). */
  min?: LogLevel;
  /** Where a formatted line goes (default: a newline-terminated write to stderr). */
  sink?: (line: string) => void;
  /** Fields merged into every record (e.g. a runId). */
  base?: LogFields;
}

/** Emits one JSON object per event to a sink. Fields are run through `redact` so a secret
 *  swept into a log payload never lands in the log (review F-C3 applies to the log plane
 *  too). Below-threshold levels are dropped. */
export class JsonLogger implements Logger {
  private readonly min: LogLevel;
  private readonly sink: (line: string) => void;
  private readonly base: LogFields;

  constructor(opts: JsonLoggerOptions = {}) {
    this.min = opts.min ?? "info";
    this.sink = opts.sink ?? ((line) => void process.stderr.write(`${line}\n`));
    this.base = opts.base ?? {};
  }

  log(level: LogLevel, event: string, fields?: LogFields): void {
    if (SEVERITY[level] < SEVERITY[this.min]) {
      return;
    }
    const payload = fields ? (redact(fields) as LogFields) : {};
    this.sink(JSON.stringify({ level, event, ...this.base, ...payload }));
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run logger.test.ts`
Expected: PASS (all 8 cases).

- [ ] **Step 5: Typecheck + Prettier + coverage of the new file**

Run: `npm run build && npx prettier --check packages/core/src/observability/logger.ts packages/core/test/observability/logger.test.ts`
Then `npx vitest run --coverage logger.test.ts` and confirm `logger.ts` is 100% (every `??` branch, the level filter both ways, the `fields ?` both ways, and the default-sink arrow are exercised by the tests above).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/observability/logger.ts packages/core/test/observability/logger.test.ts
git commit -m "feat(observability): structured Logger + JsonLogger with field redaction (F-M1)"
```

---

### Task 2: Instrument the wired swallow points + thread the logger through `buildAgentRun`

**Files:**

- Modify: `packages/core/src/tools/registry.ts`
- Modify: `packages/core/src/playbook/gates.ts`
- Modify: `packages/core/src/playbook/build-agent-run.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/tools/registry.test.ts`, `test/playbook/gates.test.ts`, `test/playbook/build-agent-run.test.ts`

- [ ] **Step 1: Write failing emission tests (RED)**

Add a capturing-logger helper and new cases. In `packages/core/test/tools/registry.test.ts`, add near the top (after imports):

```ts
import { type Logger, type LogLevel } from "../../src/observability/logger.js";

function capturing(): {
  logger: Logger;
  records: { level: LogLevel; event: string; fields?: Record<string, unknown> }[];
} {
  const records: { level: LogLevel; event: string; fields?: Record<string, unknown> }[] = [];
  return {
    logger: { log: (level, event, fields) => void records.push({ level, event, fields }) },
    records,
  };
}
```

Then add these cases inside the registry describe block. Use the file's existing helpers for a
grant/context/tool — match how the existing "capability denied" and "handler throws" tests
construct their inputs (reuse the same tool/grant/ctx factories; do not invent new shapes):

```ts
it("logs a warn event when a capability is denied", async () => {
  const { logger, records } = capturing();
  const reg = new ToolRegistry(logger);
  reg.register(/* the capability-requiring tool the existing denial test uses */);
  await reg.invoke(/* call */, /* grant WITHOUT the capability */, /* ctx */);
  expect(records).toContainEqual(
    expect.objectContaining({ level: "warn", event: "capability_denied" }),
  );
});

it("logs an error event when a tool handler throws", async () => {
  const { logger, records } = capturing();
  const reg = new ToolRegistry(logger);
  reg.register(/* the throwing tool the existing throw test uses */);
  await reg.invoke(/* call */, /* grant */, /* ctx */);
  expect(records).toContainEqual(
    expect.objectContaining({ level: "error", event: "tool_threw" }),
  );
});

it("logs an error event on a confused-deputy agent mismatch", async () => {
  const { logger, records } = capturing();
  const reg = new ToolRegistry(logger);
  reg.register(/* any registered tool */);
  await reg.invoke(/* call */, /* grant for agent A */, /* ctx for a DIFFERENT agent */);
  expect(records).toContainEqual(
    expect.objectContaining({ level: "error", event: "agent_mismatch" }),
  );
});
```

In `packages/core/test/playbook/gates.test.ts`, add:

```ts
import { type Logger, type LogLevel } from "../../src/observability/logger.js";

it("logs a warn event when the validate predicate throws", async () => {
  const records: { level: LogLevel; event: string }[] = [];
  const logger: Logger = { log: (level, event) => void records.push({ level, event }) };
  const gate = new ValidateGate(async () => {
    throw new Error("predicate boom");
  }, logger);
  const verdict = await gate.evaluate({ phase: "Validate" });
  expect(verdict).toEqual({ status: "failed", reason: "predicate boom" }); // behavior unchanged
  expect(records).toContainEqual({ level: "warn", event: "gate_predicate_threw" });
});
```

In `packages/core/test/playbook/build-agent-run.test.ts`, add one minimal case proving the new
`logger` option is accepted and does not change the happy-path outcome (the real emission
coverage lives in the registry/gate unit tests above — a happy-path run hits no swallow point,
so asserting an emission here would be brittle). Reuse the file's existing `buildAgentRun`
invocation pattern (its scripted adapter, operator, and fake passing `validateGate`):

```ts
import { type Logger } from "../../src/observability/logger.js";

it("accepts an injected logger without changing the happy-path result", async () => {
  const logger: Logger = { log: () => {} };
  // ...reuse this file's build helper, adding `logger` to the opts...
  const built = await /* buildAgentRun({ ...sameOptsAsOtherTests, logger }) */;
  expect(await built.run.run()).toEqual({ kind: "completed" });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx vitest run registry.test.ts gates.test.ts build-agent-run.test.ts`
Expected: FAIL — `ToolRegistry`/`ValidateGate` take no logger and emit nothing; `buildAgentRun`
has no `logger` option.

- [ ] **Step 3: Instrument `ToolRegistry`**

In `packages/core/src/tools/registry.ts`, import the logger and add an injected logger with a
default, then emit at the three swallow points (agent mismatch, capability denied, handler
throw). Add to the imports:

```ts
import { type Logger, noopLogger } from "../observability/logger.js";
```

Add a constructor to the class (the `tools` field initializer is unaffected):

```ts
export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  constructor(private readonly logger: Logger = noopLogger) {}
```

In `invoke`, add a log immediately before the relevant `fail(...)` returns:

```ts
if (grant.agentId !== ctx.agentId) {
  this.logger.log("error", "agent_mismatch", {
    tool: call.tool,
    grantAgent: grant.agentId,
    ctxAgent: ctx.agentId,
  });
  return fail(call, `agent mismatch: grant is for ${grant.agentId}, context is ${ctx.agentId}`);
}
```

```ts
if (missing.length > 0) {
  this.logger.log("warn", "capability_denied", {
    tool: call.tool,
    missing: missing.map((c) => c.name),
  });
  return fail(call, `capability denied: ${missing.map((c) => c.name).join(", ")}`);
}
```

```ts
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.log("error", "tool_threw", { tool: call.tool, error });
      return fail(call, error);
    }
```

- [ ] **Step 4: Instrument `ValidateGate`**

In `packages/core/src/playbook/gates.ts`, add the import and the optional logger param, and
emit on the predicate throw:

```ts
import { type Logger, noopLogger } from "../observability/logger.js";
```

```ts
export class ValidateGate implements PhaseGate {
  constructor(
    private readonly check: ValidatePredicate,
    private readonly logger: Logger = noopLogger,
  ) {}

  async evaluate(): Promise<GateVerdict> {
    try {
      const result = await this.check();
      return result.ok
        ? { status: "passed" }
        : { status: "failed", reason: result.detail ?? "validation failed" };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.log("warn", "gate_predicate_threw", { reason });
      return { status: "failed", reason };
    }
  }
}
```

- [ ] **Step 5: Thread the logger through `buildAgentRun`**

In `packages/core/src/playbook/build-agent-run.ts`, add the import, an optional `logger` opt,
and pass it to the registry and the default validate gate:

```ts
import { type Logger, noopLogger } from "../observability/logger.js";
```

Add to `BuildAgentRunOpts` (after `clock?`):

```ts
  /** Structured logger for swallow-point diagnostics; defaults to a no-op (silent). The
   *  CLIs inject a JsonLogger to turn observability on. */
  logger?: Logger;
```

In the body:

```ts
const logger = opts.logger ?? noopLogger;
const registry = new ToolRegistry(logger);
```

```ts
const validateGate =
  opts.validateGate ?? new ValidateGate(gateCommandPredicate(DEFAULT_GATE_COMMANDS), logger);
```

- [ ] **Step 6: Re-export the logger from the core index**

In `packages/core/src/index.ts`, add a barrel export (the file uses `export * from "..."` per
module — add one matching line, grouped sensibly with the other `src/` modules):

```ts
export * from "./observability/logger.js";
```

- [ ] **Step 7: Run the tests + build to verify GREEN**

Run: `npx vitest run registry.test.ts gates.test.ts build-agent-run.test.ts logger.test.ts && npm run build`
Expected: PASS and a clean build. Existing registry/gate tests still pass (the logger defaults
to `noopLogger`).

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/tools/registry.ts packages/core/src/playbook/gates.ts \
  packages/core/src/playbook/build-agent-run.ts packages/core/src/index.ts \
  packages/core/test/tools/registry.test.ts packages/core/test/playbook/gates.test.ts \
  packages/core/test/playbook/build-agent-run.test.ts
git commit -m "feat(observability): emit at tool-registry + validate-gate swallow points (F-M1)"
```

---

### Task 3: Turn logging on in the CLIs + roadmap + full gate

**Files:**

- Modify: `packages/core/src/bin/run.ts`, `packages/state/src/bin/openhawkins-run.ts`
- Modify: `docs/reviews/2026-06-09-production-readiness-review.md`

> **CLI scope:** wire the two CLIs that route through `buildAgentRun`'s new `logger` seam —
> `bin/run.ts` (the demo playbook run) and `openhawkins-run` (the durable production
> entrypoint). **`bin/ask.ts` is intentionally NOT wired here:** it uses `buildProbeAgent`
> (`eval/scenarios.ts`) — a separate no-playbook path that builds its own `ToolRegistry` — so
> wiring it would add a logger seam (and a covered branch) to `scenarios.ts`. That is deferred
> to **A7b** alongside the markdownify instrumentation. `bin/**` is excluded from coverage
> (covered end-to-end), so these two edits need no unit test; the logger writes to **stderr**
> only, so the functional suite's stdout assertions are unaffected.

- [ ] **Step 1: Inject a `JsonLogger` in the two playbook CLIs**

- `packages/core/src/bin/run.ts`: import `JsonLogger` from `../observability/logger.js` and add
  `logger: new JsonLogger()` to the `buildAgentRun({ ... })` opts.
- `packages/state/src/bin/openhawkins-run.ts`: import `JsonLogger` from `@openhawkins/core` and
  add `logger: new JsonLogger()` to the `buildDurableAgentRun({ ... })` opts (it flows through
  `...runOpts` into `buildAgentRun` automatically).

- [ ] **Step 2: Verify the functional suite still passes (stdout unchanged)**

Run: `npm run test:functional`
Expected: 7 passed / 1 skipped. The CLIs' JSON trace on **stdout** is unchanged; logger output
goes to stderr.

- [ ] **Step 3: Mark A7 done in the roadmap**

In `docs/reviews/2026-06-09-production-readiness-review.md`, replace the A7 line (item 7) with:

```md
7. **A7 — Observability (F-M1) ✅ DONE (PR pending).** A dependency-free structured `Logger` (`log(level, event, fields?)`) with a `noopLogger` default and a `JsonLogger` that emits one redacted JSON object per event to stderr (log fields run through `redact`, so the F-C3 guarantee covers the log plane). Wired at the live swallow points: `ToolRegistry.invoke` (capability denial → warn, confused-deputy agent mismatch → error, swallowed handler exception → error) and `ValidateGate.evaluate` (predicate throw → warn), threaded through `buildAgentRun` and turned on in the playbook CLIs (`bin/run.ts` + the durable `openhawkins-run`, both to stderr). **A7b (future)** — (a) instrument the markdownify `ConverterRegistry` degrade-to-fallback warnings once markdownify is wired into the agent path (F-H6) — it will take a structural log-sink, since markdownify must not import `core`; (b) thread the logger through `buildProbeAgent`/`bin/ask.ts` (the no-playbook vertical-slice path).
```

- [ ] **Step 4: Full repo gate**

Run:

```bash
npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional
```

Expected: all green, coverage 100%.

- [ ] **Step 5: Docker gate**

Run: `docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test`
Expected: `✅ ALL GATES PASSED`

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/bin/ask.ts packages/core/src/bin/run.ts \
  packages/state/src/bin/openhawkins-run.ts docs/reviews/2026-06-09-production-readiness-review.md
git commit -m "feat(observability): enable JsonLogger in the CLIs; mark A7 done (F-M1)"
```
