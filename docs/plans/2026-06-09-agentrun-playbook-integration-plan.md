# AgentRun + End-to-End Robustness Automation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `PlaybookRun` into a real agent run via a thin `AgentRun` orchestrator, supply operators (scripted + human), a production factory + `openhawkins run` CLI, and a robust end-to-end automation — an in-process full-stack robustness matrix plus a black-box CLI functional test — that proves the whole system (Agent + Playbook + gates + events + audit + operator) works and degrades safely.

**Architecture:** `AgentRun` (`packages/core/src/playbook/agent-run.ts`) sequences a run over an injected `PlaybookRun`: run a caller-supplied `PhaseHandler`, `advance()` the gate, and on a soft-phase pause consult an `Operator` to override (audited) or halt. Operators live in `playbook/operators.ts`. A production factory (`playbook/build-agent-run.ts`) wires the real gates + `Agent`-backed handlers + a **shared `AuditLog`** so one hash-chained trace covers agent turns _and_ phase transitions. The `openhawkins run` CLI (`bin/run.ts`) is the user entry. Robustness is proven by an in-process suite and a black-box functional test.

**Tech Stack:** TypeScript (strict: `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM with `.js` import specifiers, Vitest, Node 24 + Bun 1.3. Prettier printWidth 100, double quotes.

**Spec:** [`docs/specs/2026-06-09-agentrun-playbook-integration-design.md`](../specs/2026-06-09-agentrun-playbook-integration-design.md).

**Depends on (merged):**

- `playbook/runner.ts` — `PlaybookRun` (`start`, `state`, `status()`, `advance()`, `override(actor,reason)`), `RunStatus`, `PlaybookRunDeps`.
- `playbook/manifest.ts` — `Phase`, `DEFAULT_MANIFEST`.
- `playbook/gates.ts` — `SoftGate`, `ValidateGate`, `PhaseGate`.
- `playbook/gate-command.ts` — `gateCommandPredicate`, `DEFAULT_GATE_COMMANDS`.
- `eval/agent.ts` — `Agent` (`Agent.start(cfg)`, `agent.ask(input): Promise<TurnRecord>`, `agent.audit`). `AgentConfig` accepts `store?`, `audit?`, `clock?`.
- `eval/scenarios.ts` — `buildProbeAgent`, `weakHostFactsModel`.
- `session/events.ts` — `InMemoryEventStore`; `security/audit.ts` — `InMemoryAuditLog`, `AuditLog`; `security/capability.ts` — `AgentGrant`; `util/clock.ts` — `fixedClock`, `systemClock`.

**Conventions to follow (read before starting):**

- Unit tests: `packages/core/test/playbook/<name>.test.ts` (import `../../src/...js`). Functional tests: `packages/core/test-functional/<name>.e2e.test.ts` (black-box; spawn built `dist/` CLI; do NOT import source).
- ESM `.js` specifiers. Coverage ≥99%; each new src file 100% — real behavior tests.
- `AgentRun.run()` must surface a thrown `PhaseHandler` (work failure ≠ gate failure) but otherwise return a structured `AgentRunResult` (never throw for escalation/decline).
- **Never run the real repo gate inside a test** (it would re-invoke `npm run coverage` recursively). Tests use a fake/trivial `ValidateGate`; only production wires `DEFAULT_GATE_COMMANDS`.

---

### Task 1: `AgentRun` orchestrator — types + run loop

**Files:**

- Create: `packages/core/src/playbook/agent-run.ts`
- Test: `packages/core/test/playbook/agent-run.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/playbook/agent-run.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AgentRun, type Operator, type PhaseHandler } from "../../src/playbook/agent-run.js";
import { PlaybookRun, type PlaybookRunDeps } from "../../src/playbook/runner.js";
import { DEFAULT_MANIFEST } from "../../src/playbook/manifest.js";
import { SoftGate, ValidateGate, type PhaseGate } from "../../src/playbook/gates.js";
import { isPhaseEvent } from "../../src/playbook/events.js";
import { InMemoryEventStore } from "../../src/session/events.js";
import { InMemoryAuditLog } from "../../src/security/audit.js";
import { fixedClock } from "../../src/util/clock.js";
import type { AgentGrant } from "../../src/security/capability.js";
import type { Phase } from "../../src/playbook/manifest.js";

const OPERATOR_GRANT: AgentGrant = { agentId: "op", capabilities: [{ name: "playbook:override" }] };
const fakeGate = (v: Awaited<ReturnType<PhaseGate["evaluate"]>>): PhaseGate => ({
  evaluate: async () => v,
});

/** Approves every soft phase with a fixed actor/reason. */
const approveAll: Operator = {
  review: async () => ({ approve: true, actor: "op", reason: "ok" }),
};

function playbookDeps(over: Partial<PlaybookRunDeps> = {}): PlaybookRunDeps {
  return {
    manifest: DEFAULT_MANIFEST,
    sessionId: "s1",
    runId: "r1",
    store: new InMemoryEventStore(),
    audit: new InMemoryAuditLog(),
    grant: OPERATOR_GRANT,
    softGate: new SoftGate(),
    validateGate: fakeGate({ status: "passed" }),
    clock: fixedClock(1000),
    ...over,
  };
}

const phasesOf = async (store: InMemoryEventStore): Promise<string[]> =>
  (await store.read("s1")).filter(isPhaseEvent).map((e) => `${e.type}:${e.phase}`);

describe("AgentRun.run — clean run", () => {
  it("drives Research->...->Present, running handlers in order and auditing the trace", async () => {
    const d = playbookDeps();
    const seen: Phase[] = [];
    const handlers: Partial<Record<Phase, PhaseHandler>> = {
      Research: async ({ phase }) => void seen.push(phase),
      Plan: async ({ phase }) => void seen.push(phase),
      Tasks: async ({ phase }) => void seen.push(phase),
      Execute: async ({ phase }) => void seen.push(phase),
    };
    const playbook = await PlaybookRun.start(d);
    const result = await new AgentRun({ playbook, handlers, operator: approveAll }).run();

    expect(result).toEqual({ kind: "completed" });
    expect(seen).toEqual(["Research", "Plan", "Tasks", "Execute"]);
    // soft phases were overridden, Validate passed -> Present
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual([
      "PhaseEntered:Research",
      "PhaseOverridden:Research",
      "PhaseEntered:Plan",
      "PhaseOverridden:Plan",
      "PhaseEntered:Tasks",
      "PhaseOverridden:Tasks",
      "PhaseEntered:Execute",
      "PhaseOverridden:Execute",
      "PhaseEntered:Validate",
      "PhaseGatePassed:Validate",
      "PhaseEntered:Present",
    ]);
    expect(await d.audit.verify()).toBe(true);
  });

  it("returns completed immediately for a run already at the terminal phase", async () => {
    const d = playbookDeps();
    const playbook = await PlaybookRun.start(d);
    // force to Present
    for (let i = 0; i < 4; i++) await playbook.override("op", "skip");
    await playbook.advance(); // Validate passed -> Present
    const before = (await (d.store as InMemoryEventStore).read("s1")).length;
    const result = await new AgentRun({ playbook, handlers: {}, operator: approveAll }).run();
    expect(result).toEqual({ kind: "completed" });
    expect((await (d.store as InMemoryEventStore).read("s1")).length).toBe(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/agent-run.test.ts`
Expected: FAIL — cannot find module `../../src/playbook/agent-run.js`.

- [ ] **Step 3: Write `packages/core/src/playbook/agent-run.ts`**

```ts
import type { Phase } from "./manifest.js";
import type { PlaybookRun } from "./runner.js";

/** Work for one phase — caller-supplied; typically closes over an `Agent` and calls
 *  `agent.ask(...)`. A phase with no handler (e.g. Validate, whose work is the gate) is
 *  a no-op. */
export type PhaseHandler = (ctx: { phase: Phase }) => Promise<void>;

/** An operator's decision when a soft phase pauses. */
export type OperatorDecision =
  | { approve: true; actor: string; reason: string }
  | { approve: false };

/** Consulted whenever a soft phase pauses. The runtime still owns the transition — this
 *  only supplies the capability-gated, audited override decision. */
export interface Operator {
  review(req: { phase: Phase; reason: string }): Promise<OperatorDecision>;
}

/** Why a run stopped. */
export type AgentRunResult =
  | { kind: "completed" }
  | { kind: "halted-by-operator"; phase: Phase }
  | { kind: "escalated"; phase: Phase; reason: string };

export interface AgentRunDeps {
  playbook: PlaybookRun;
  handlers: Partial<Record<Phase, PhaseHandler>>;
  operator: Operator;
}

/**
 * Sequences a real agent run through a `PlaybookRun`: run a phase's work, let the runtime
 * gate the transition, and on a soft-phase pause consult the operator to override (audited)
 * or halt. Adds no events of its own — the `PlaybookRun` it drives owns the event log and
 * Murray audit, so a full run is replayable and tamper-evident.
 */
export class AgentRun {
  constructor(private readonly deps: AgentRunDeps) {}

  async run(): Promise<AgentRunResult> {
    const { playbook, handlers, operator } = this.deps;
    for (;;) {
      const current = playbook.status();
      if (current.kind === "done") {
        return { kind: "completed" };
      }
      if (current.kind === "escalated") {
        return { kind: "escalated", phase: current.phase, reason: current.reason };
      }

      const phase = playbook.state.phase;
      await handlers[phase]?.({ phase });
      let status = await playbook.advance();

      if (status.kind === "awaiting-operator") {
        const decision = await operator.review({ phase, reason: status.reason });
        if (!decision.approve) {
          return { kind: "halted-by-operator", phase };
        }
        status = await playbook.override(decision.actor, decision.reason);
        // A granted override advances; if it did not (the grant lacks the capability, so
        // `override` denied + audited it), the phase is unchanged — halt rather than re-loop.
        if (status.kind === "awaiting-operator") {
          return { kind: "halted-by-operator", phase };
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/playbook/agent-run.test.ts`
Expected: PASS (2 tests). Full per-file coverage is completed by Task 2's matrix; just confirm these pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/playbook/agent-run.ts packages/core/test/playbook/agent-run.test.ts
git commit -m "feat(playbook): AgentRun orchestrator — sequence a run through the Playbook"
```

---

### Task 2: `AgentRun` robustness matrix (replan, escalation, decline, throw, misconfigured override)

**Files:**

- Modify: `packages/core/test/playbook/agent-run.test.ts` (add the matrix; reuse the Task 1 helpers)

- [ ] **Step 1: Write the failing/asserting tests**

Append to `packages/core/test/playbook/agent-run.test.ts`:

```ts
describe("AgentRun.run — robustness matrix", () => {
  it("replans when Validate fails once, re-running Plan..Execute, then completes", async () => {
    // A validateGate that fails the first time and passes after.
    let calls = 0;
    const flakyValidate: PhaseGate = {
      evaluate: async () =>
        calls++ === 0 ? { status: "failed", reason: "red" } : { status: "passed" },
    };
    const d = playbookDeps({ validateGate: flakyValidate });
    const ran: Phase[] = [];
    const note: PhaseHandler = async ({ phase }) => void ran.push(phase);
    const handlers: Partial<Record<Phase, PhaseHandler>> = {
      Research: note,
      Plan: note,
      Tasks: note,
      Execute: note,
    };
    const playbook = await PlaybookRun.start(d);
    const result = await new AgentRun({ playbook, handlers, operator: approveAll }).run();

    expect(result).toEqual({ kind: "completed" });
    // Plan..Execute ran twice (once before the failed Validate, once after the replan).
    expect(ran.filter((p) => p === "Plan").length).toBe(2);
    expect(ran.filter((p) => p === "Execute").length).toBe(2);
    const events = await phasesOf(d.store as InMemoryEventStore);
    expect(events).toContain("PhaseGateFailed:Validate");
    expect(events[events.length - 1]).toBe("PhaseEntered:Present");
    expect(await d.audit.verify()).toBe(true);
  });

  it("escalates when the replan budget is exhausted", async () => {
    const d = playbookDeps({
      manifest: { ...DEFAULT_MANIFEST, maxReplans: 0 },
      validateGate: fakeGate({ status: "failed", reason: "still red" }),
    });
    const note: PhaseHandler = async () => {};
    const playbook = await PlaybookRun.start(d);
    const result = await new AgentRun({
      playbook,
      handlers: { Research: note, Plan: note, Tasks: note, Execute: note },
      operator: approveAll,
    }).run();
    expect(result).toEqual({ kind: "escalated", phase: "Validate", reason: "still red" });
    expect(await d.audit.verify()).toBe(true);
  });

  it("halts when the operator declines a soft phase", async () => {
    const d = playbookDeps();
    const decline: Operator = { review: async () => ({ approve: false }) };
    const playbook = await PlaybookRun.start(d);
    const result = await new AgentRun({ playbook, handlers: {}, operator: decline }).run();
    expect(result).toEqual({ kind: "halted-by-operator", phase: "Research" });
    // only the initial PhaseEntered exists; nothing was overridden
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual(["PhaseEntered:Research"]);
  });

  it("halts when an approving operator lacks the override capability (denied + audited)", async () => {
    const d = playbookDeps({ grant: { agentId: "op", capabilities: [] } });
    const playbook = await PlaybookRun.start(d);
    const result = await new AgentRun({ playbook, handlers: {}, operator: approveAll }).run();
    expect(result).toEqual({ kind: "halted-by-operator", phase: "Research" });
    const audit = await d.audit.entries();
    expect(audit.map((e) => e.kind)).toContain("PhaseOverrideDenied");
    expect(await d.audit.verify()).toBe(true);
  });

  it("surfaces a throwing phase handler (work failure is not swallowed)", async () => {
    const d = playbookDeps();
    const boom: PhaseHandler = async () => {
      throw new Error("research tool crashed");
    };
    const playbook = await PlaybookRun.start(d);
    await expect(
      new AgentRun({ playbook, handlers: { Research: boom }, operator: approveAll }).run(),
    ).rejects.toThrow(/research tool crashed/);
    // the log stopped at the entered phase; nothing half-applied
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual(["PhaseEntered:Research"]);
  });
});
```

- [ ] **Step 2: Run + verify pass and 100% coverage of agent-run.ts**

Run: `npx vitest run packages/core/test/playbook/agent-run.test.ts --coverage.enabled --coverage.include='packages/core/src/playbook/agent-run.ts'`
Expected: all PASS; `agent-run.ts` 100% across stmts/branch/funcs/lines (done/escalated/awaiting-operator/decline/denied-override/handler-throw paths all covered). If a branch is uncovered, add a focused test.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/playbook/agent-run.test.ts
git commit -m "test(playbook): AgentRun robustness matrix (replan/escalate/decline/throw/denied)"
```

---

### Task 3: Operators — `ScriptedOperator` + `HumanOperator`

**Files:**

- Create: `packages/core/src/playbook/operators.ts`
- Test: `packages/core/test/playbook/operators.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/playbook/operators.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ScriptedOperator, HumanOperator } from "../../src/playbook/operators.js";

describe("ScriptedOperator", () => {
  it("returns its decisions in order, then declines once exhausted", async () => {
    const op = new ScriptedOperator([
      { approve: true, actor: "alice", reason: "spikes done" },
      { approve: false },
    ]);
    expect(await op.review({ phase: "Research", reason: "x" })).toEqual({
      approve: true,
      actor: "alice",
      reason: "spikes done",
    });
    expect(await op.review({ phase: "Plan", reason: "x" })).toEqual({ approve: false });
    // exhausted -> declines (a safe default rather than throwing)
    expect(await op.review({ phase: "Tasks", reason: "x" })).toEqual({ approve: false });
  });
});

describe("HumanOperator", () => {
  it("approves on a 'y' line and declines otherwise, prompting with the phase + reason", async () => {
    const lines = ["y\n", "n\n"];
    const out: string[] = [];
    const op = new HumanOperator({
      actor: "carol",
      readLine: async () => lines.shift() ?? "n\n",
      write: (s) => void out.push(s),
    });
    const yes = await op.review({ phase: "Research", reason: "confirm spikes" });
    expect(yes).toEqual({ approve: true, actor: "carol", reason: "operator approved Research" });
    expect(out.join("")).toContain("Research");
    expect(out.join("")).toContain("confirm spikes");
    const no = await op.review({ phase: "Plan", reason: "confirm plan" });
    expect(no).toEqual({ approve: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/operators.test.ts`
Expected: FAIL — cannot find module `../../src/playbook/operators.js`.

- [ ] **Step 3: Write `packages/core/src/playbook/operators.ts`**

```ts
import type { Phase } from "./manifest.js";
import type { Operator, OperatorDecision } from "./agent-run.js";

/** A deterministic operator for tests / unattended runs: returns a fixed list of
 *  decisions in order, then declines (a safe default — never silently approves). */
export class ScriptedOperator implements Operator {
  private i = 0;
  constructor(private readonly decisions: OperatorDecision[]) {}

  async review(_req: { phase: Phase; reason: string }): Promise<OperatorDecision> {
    return this.decisions[this.i++] ?? { approve: false };
  }
}

/** IO seam so the human operator is testable without a real TTY. */
export interface HumanOperatorIo {
  actor: string;
  /** Read one line of operator input (e.g. from stdin). */
  readLine: () => Promise<string>;
  /** Write a prompt (e.g. to stdout). */
  write: (s: string) => void;
}

/** Prompts a human to approve/decline a paused soft phase. Approves on a line starting
 *  with `y`; anything else declines. */
export class HumanOperator implements Operator {
  constructor(private readonly io: HumanOperatorIo) {}

  async review(req: { phase: Phase; reason: string }): Promise<OperatorDecision> {
    this.io.write(
      `\n[playbook] phase "${req.phase}" needs approval: ${req.reason}\n  approve? [y/N] `,
    );
    const line = (await this.io.readLine()).trim().toLowerCase();
    if (line.startsWith("y")) {
      return { approve: true, actor: this.io.actor, reason: `operator approved ${req.phase}` };
    }
    return { approve: false };
  }
}
```

- [ ] **Step 4: Run test to verify it passes + 100% coverage**

Run: `npx vitest run packages/core/test/playbook/operators.test.ts --coverage.enabled --coverage.include='packages/core/src/playbook/operators.ts'`
Expected: PASS (2 tests); `operators.ts` 100% (the exhausted-`?? {approve:false}` branch, the `y`/else branches are covered).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/playbook/operators.ts packages/core/test/playbook/operators.test.ts
git commit -m "feat(playbook): ScriptedOperator + HumanOperator (injectable IO)"
```

---

### Task 4: Production factory — Agent-backed handlers + shared audit

**Files:**

- Create: `packages/core/src/playbook/build-agent-run.ts`
- Test: `packages/core/test/playbook/build-agent-run.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/playbook/build-agent-run.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildAgentRun } from "../../src/playbook/build-agent-run.js";
import { ScriptedOperator } from "../../src/playbook/operators.js";
import { weakHostFactsModel } from "../../src/eval/scenarios.js";
import { ValidateGate } from "../../src/playbook/gates.js";
import { tmpdir } from "node:os";

const approve = () =>
  new ScriptedOperator([
    { approve: true, actor: "op", reason: "r" },
    { approve: true, actor: "op", reason: "p" },
    { approve: true, actor: "op", reason: "t" },
    { approve: true, actor: "op", reason: "e" },
  ]);

describe("buildAgentRun", () => {
  it("runs a real Agent inside the Execute phase and completes the process", async () => {
    const { run, audit, agent, store } = await buildAgentRun({
      adapter: weakHostFactsModel(tmpdir()),
      grounding: "cited",
      prompts: { Execute: "How much disk space is free on this machine?" },
      operator: approve(),
      validateGate: new ValidateGate(async () => ({ ok: true })), // fake gate (no recursion)
    });
    const result = await run.run();
    expect(result).toEqual({ kind: "completed" });

    // the agent actually ran a grounded turn inside Execute (disk_free tool was called)
    const auditKinds = (await audit.entries()).map((e) => e.kind);
    expect(auditKinds).toContain("ToolReturned");
    expect(auditKinds).toContain("FinalAccepted");
    // ...and the phase transitions are in the SAME chain, which verifies end-to-end
    expect(auditKinds).toContain("PhaseEntered");
    expect(auditKinds).toContain("PhaseGatePassed");
    expect(await audit.verify()).toBe(true);

    // the agent and the playbook share one event store + one audit log
    expect(agent).toBeDefined();
    expect((await store.read("probe-agent-session")).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/build-agent-run.test.ts`
Expected: FAIL — cannot find module `../../src/playbook/build-agent-run.js`.

- [ ] **Step 3: Write `packages/core/src/playbook/build-agent-run.ts`**

```ts
import { Agent } from "../eval/agent.js";
import { ToolRegistry } from "../tools/registry.js";
import { diskFreeTool } from "../tools/disk-free.js";
import type { GroundingMode } from "../grounding/eleven.js";
import { InMemoryEventStore, type EventStore } from "../session/events.js";
import { InMemoryAuditLog, type AuditLog } from "../security/audit.js";
import { type Clock, systemClock } from "../util/clock.js";
import type { AgentGrant } from "../security/capability.js";
import { DEFAULT_MANIFEST, type Phase } from "./manifest.js";
import { SoftGate, ValidateGate, type PhaseGate } from "./gates.js";
import { gateCommandPredicate, DEFAULT_GATE_COMMANDS } from "./gate-command.js";
import { PlaybookRun } from "./runner.js";
import { AgentRun, type Operator, type PhaseHandler } from "./agent-run.js";

export interface BuildAgentRunOpts {
  adapter: Parameters<typeof Agent.start>[0]["adapter"];
  grounding: GroundingMode;
  /** Per-phase prompts; a phase with a prompt runs `agent.ask(prompt)` as its work. */
  prompts: Partial<Record<Phase, string>>;
  operator: Operator;
  /** Defaults to the REAL repo gate. Tests pass a fake to avoid recursively running it. */
  validateGate?: PhaseGate;
  clock?: Clock;
}

export interface BuiltAgentRun {
  run: AgentRun;
  agent: Agent;
  store: EventStore;
  audit: AuditLog;
}

/**
 * Wire a real agent run: one shared `EventStore` + `AuditLog` across the `Agent` and the
 * `PlaybookRun`, so a single hash-chained trace covers grounded turns AND phase
 * transitions. Each phase with a configured prompt runs `agent.ask(prompt)` as its work;
 * Validate runs the real repo gate by default.
 */
export async function buildAgentRun(opts: BuildAgentRunOpts): Promise<BuiltAgentRun> {
  const clock = opts.clock ?? systemClock;
  const store = new InMemoryEventStore();
  const audit = new InMemoryAuditLog();
  const grant: AgentGrant = {
    agentId: "probe-agent",
    capabilities: [{ name: "host:info" }, { name: "playbook:override" }],
  };

  const registry = new ToolRegistry();
  registry.register(diskFreeTool);
  const agent = await Agent.start({
    agentId: "probe-agent",
    adapter: opts.adapter,
    registry,
    grant,
    tools: [diskFreeTool],
    grounding: { mode: opts.grounding, qualifyingTools: ["disk_free"] },
    systemPrompt: "You are probe-agent. Answer questions about this host accurately.",
    store,
    audit,
    clock,
  });

  const handlers: Partial<Record<Phase, PhaseHandler>> = {};
  for (const [phase, prompt] of Object.entries(opts.prompts) as [Phase, string][]) {
    handlers[phase] = async () => void (await agent.ask(prompt));
  }

  const validateGate =
    opts.validateGate ?? new ValidateGate(gateCommandPredicate(DEFAULT_GATE_COMMANDS));
  const playbook = await PlaybookRun.start({
    manifest: DEFAULT_MANIFEST,
    sessionId: "probe-agent-session",
    runId: "probe-agent-run",
    store,
    audit,
    grant,
    softGate: new SoftGate(),
    validateGate,
    clock,
  });

  return {
    run: new AgentRun({ playbook, handlers, operator: opts.operator }),
    agent,
    store,
    audit,
  };
}
```

Note: `Agent.start`'s config type is imported structurally via `Parameters<typeof Agent.start>[0]["adapter"]` to avoid a separate `ModelAdapter` import churn; if the strict compiler prefers an explicit `import type { ModelAdapter }`, use that instead — verify and pick whichever compiles cleanly.

- [ ] **Step 4: Run test to verify it passes + coverage**

Run: `npx vitest run packages/core/test/playbook/build-agent-run.test.ts --coverage.enabled --coverage.include='packages/core/src/playbook/build-agent-run.ts'`
Expected: PASS (1 test); `build-agent-run.ts` 100% (the `?? real gate` branch is the only un-hit line — it is covered because the test passes a `validateGate`, exercising the left side; add a second tiny test that omits `validateGate` and asserts the built run's type if needed, WITHOUT calling `.run()` so the real gate never executes).

> To cover the `?? new ValidateGate(gateCommandPredicate(DEFAULT_GATE_COMMANDS))` default WITHOUT running the gate: add a test that calls `buildAgentRun({... no validateGate ...})` and asserts `built.run instanceof AgentRun` (construction only — never `.run()`), so the default-gate expression is evaluated and covered but never spawned.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/playbook/build-agent-run.ts packages/core/test/playbook/build-agent-run.test.ts
git commit -m "feat(playbook): buildAgentRun factory — Agent-backed handlers, shared audit"
```

---

### Task 5: Barrel exports

**Files:**

- Modify: `packages/core/src/playbook/index.ts`
- Test: `packages/core/test/playbook/index.test.ts`

- [ ] **Step 1: Add to the barrel test** (inside the existing `it("re-exports …")`):

```ts
expect(typeof playbook.AgentRun).toBe("function");
expect(typeof playbook.ScriptedOperator).toBe("function");
expect(typeof playbook.HumanOperator).toBe("function");
expect(typeof playbook.buildAgentRun).toBe("function");
```

- [ ] **Step 2: Run → fail**, then extend `packages/core/src/playbook/index.ts`:

```ts
export * from "./manifest.js";
export * from "./events.js";
export * from "./machine.js";
export * from "./gates.js";
export * from "./gate-command.js";
export * from "./runner.js";
export * from "./agent-run.js";
export * from "./operators.js";
export * from "./build-agent-run.js";
```

- [ ] **Step 3: Run → pass.**

Run: `npx vitest run packages/core/test/playbook/index.test.ts` → PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/playbook/index.ts packages/core/test/playbook/index.test.ts
git commit -m "feat(playbook): export AgentRun, operators, buildAgentRun"
```

---

### Task 6: In-process end-to-end robustness suite

This is the **robust automation that validates the whole system end to end**: real `Agent`
(scripted) + real `PlaybookRun` + real `SoftGate` + a fast `ValidateGate` + `ScriptedOperator`,
exercising every path through the FULL stack and the unified audit chain.

**Files:**

- Test: `packages/core/test/playbook/system-e2e.test.ts`

- [ ] **Step 1: Write the suite**

`packages/core/test/playbook/system-e2e.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { buildAgentRun } from "../../src/playbook/build-agent-run.js";
import { ScriptedOperator } from "../../src/playbook/operators.js";
import { weakHostFactsModel } from "../../src/eval/scenarios.js";
import { ValidateGate, type PhaseGate } from "../../src/playbook/gates.js";
import { isPhaseEvent } from "../../src/playbook/events.js";
import { foldPlaybook, type PhaseEvent } from "../../src/playbook/events.js";
import { InMemoryEventStore } from "../../src/session/events.js";

const PROMPT = "How much disk space is free on this machine?";
const approveFour = () =>
  new ScriptedOperator(
    Array.from({ length: 8 }, () => ({ approve: true as const, actor: "op", reason: "ok" })),
  );

async function build(validateGate: PhaseGate, opGen = approveFour) {
  return buildAgentRun({
    adapter: weakHostFactsModel(tmpdir()),
    grounding: "cited",
    prompts: { Execute: PROMPT },
    operator: opGen(),
    validateGate,
    clock: undefined,
  });
}

describe("system end-to-end robustness", () => {
  it("a complete run: real agent turn inside Execute, full audited + replayable trace", async () => {
    const built = await build(new ValidateGate(async () => ({ ok: true })));
    expect(await built.run.run()).toEqual({ kind: "completed" });

    const events = await built.store.read("probe-agent-session");
    const phaseEvents = events.filter(isPhaseEvent) as PhaseEvent[];
    // the process reached Present, and the folded state agrees with the log (replay)
    expect(foldPlaybook(phaseEvents).phase).toBe("Present");
    // the agent's grounded turn is in the SAME unified, tamper-evident chain
    const kinds = (await built.audit.entries()).map((e) => e.kind);
    expect(kinds).toContain("ToolReturned");
    expect(kinds).toContain("FinalAccepted");
    expect(kinds).toContain("PhaseEntered");
    expect(await built.audit.verify()).toBe(true);
  });

  it("replans through a flaky Validate, then completes", async () => {
    let n = 0;
    const flaky: PhaseGate = {
      evaluate: async () =>
        n++ === 0 ? { status: "failed", reason: "red" } : { status: "passed" },
    };
    const built = await build(
      flaky,
      () =>
        new ScriptedOperator(
          Array.from({ length: 12 }, () => ({ approve: true as const, actor: "op", reason: "ok" })),
        ),
    );
    expect(await built.run.run()).toEqual({ kind: "completed" });
    const kinds = (await built.audit.entries()).map((e) => e.kind);
    expect(kinds).toContain("PhaseGateFailed");
    expect(await built.audit.verify()).toBe(true);
  });

  it("escalates when Validate never passes within budget", async () => {
    const built = await buildAgentRun({
      adapter: weakHostFactsModel(tmpdir()),
      grounding: "cited",
      prompts: { Execute: PROMPT },
      operator: approveFour(),
      validateGate: new ValidateGate(async () => ({ ok: false, detail: "perma-red" })),
    });
    const result = await built.run.run();
    expect(result.kind).toBe("escalated");
    expect(await built.audit.verify()).toBe(true);
  });

  it("produces one unified, verifiable audit chain over the whole run", async () => {
    // The agent's grounded turn AND every phase transition share ONE hash-chained log,
    // so a single verify() proves the entire run is intact end-to-end. (The flip-an-entry
    // -> verify()===false proof lives in security/audit.test.ts, which owns the chain.)
    const built = await build(new ValidateGate(async () => ({ ok: true })));
    await built.run.run();
    const entries = await built.audit.entries();
    expect(entries.length).toBeGreaterThan(6); // agent steps + all phase transitions
    expect(entries.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["FinalAccepted", "PhaseEntered"]),
    );
    expect(await built.audit.verify()).toBe(true);
  });

  it("replays deterministically: same scripted inputs -> identical phase-event trace", async () => {
    const a = await build(new ValidateGate(async () => ({ ok: true })));
    const b = await build(new ValidateGate(async () => ({ ok: true })));
    await a.run.run();
    await b.run.run();
    const seq = async (s: InMemoryEventStore): Promise<string[]> =>
      (await s.read("probe-agent-session")).filter(isPhaseEvent).map((e) => `${e.type}:${e.phase}`);
    expect(await seq(a.store as InMemoryEventStore)).toEqual(
      await seq(b.store as InMemoryEventStore),
    );
  });
});
```

- [ ] **Step 3: Run + verify pass**

Run: `npx vitest run packages/core/test/playbook/system-e2e.test.ts`
Expected: all PASS. These exercise the full stack deterministically; the disk number is pinned irrelevant (the final-answer text is not asserted here — only the process trace + audit). No real repo gate runs.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/playbook/system-e2e.test.ts
git commit -m "test(playbook): in-process system end-to-end robustness suite"
```

---

### Task 7: The `openhawkins run` CLI

**Files:**

- Create: `packages/core/src/bin/run.ts`

- [ ] **Step 1: Write `packages/core/src/bin/run.ts`**

```ts
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import type { ModelAdapter } from "../models/adapter.js";
import type { GroundingMode } from "../grounding/eleven.js";
import { weakHostFactsModel } from "../eval/scenarios.js";
import { buildAgentRun } from "../playbook/build-agent-run.js";
import { HumanOperator } from "../playbook/operators.js";
import { ScriptedOperator } from "../playbook/operators.js";
import { ValidateGate } from "../playbook/gates.js";

/**
 * `openhawkins run` — drive a real agent run as a Playbook-governed process. The scripted
 * model + a trivial Validate make a deterministic, offline demo (the REAL orchestrator,
 * gates plumbing, events and audit still run). `--approve-all` runs unattended (a
 * ScriptedOperator that approves every soft phase — still audited); otherwise a human is
 * prompted at each soft phase. `--json` prints the run result + audit summary.
 */
function flag(args: string[], name: string, fallback: string): string {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : fallback;
}

function buildAdapter(kind: string, path: string): ModelAdapter {
  if (kind === "scripted") return weakHostFactsModel(path);
  throw new Error(`unknown --model "${kind}" (this demo CLI supports: scripted)`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modelKind = flag(args, "--model", "scripted");
  const grounding = flag(args, "--grounding", "cited") as GroundingMode;
  const path = flag(args, "--path", tmpdir());
  const approveAll = args.includes("--approve-all");
  const asJson = args.includes("--json");

  const operator = approveAll
    ? new ScriptedOperator(
        Array.from({ length: 8 }, () => ({ approve: true as const, actor: "cli", reason: "auto" })),
      )
    : new HumanOperator({
        actor: process.env.USER ?? "operator",
        readLine: readStdinLine,
        write: (s) => process.stdout.write(s),
      });

  const built = await buildAgentRun({
    adapter: buildAdapter(modelKind, path),
    grounding,
    prompts: { Execute: "How much disk space is free on this machine?" },
    operator,
    // Demo Validate: a real ValidateGate over a trivial command — exercises the gate
    // plumbing end-to-end without recursively running the repo's own gate.
    validateGate: new ValidateGate(async () => ({ ok: true })),
  });

  const result = await built.run.run();
  const verified = await built.audit.verify();
  if (asJson) {
    const entries = await built.audit.entries();
    console.log(JSON.stringify({ result, auditEntries: entries.length, auditVerified: verified }));
  } else {
    console.log(`run ${result.kind}; audit ${verified ? "verified" : "TAMPERED"}`);
  }
}

function readStdinLine(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin });
    rl.once("line", (line) => {
      rl.close();
      resolve(line);
    });
  });
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
```

Note: `bin/**` is excluded from unit coverage (see `vitest.config.ts`) — the CLI is exercised by the black-box functional test in Task 8, not the unit suite. Keep logic thin; anything worth unit-testing belongs in `build-agent-run.ts`/`operators.ts` (already covered).

- [ ] **Step 2: Build to verify it compiles**

Run: `npm run build`
Expected: clean (`dist/bin/run.js` produced).

- [ ] **Step 3: Smoke-run it locally**

Run: `node packages/core/dist/bin/run.js --approve-all --json`
Expected: a JSON line like `{"result":{"kind":"completed"},"auditEntries":<n>,"auditVerified":true}`.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/bin/run.ts
git commit -m "feat(playbook): openhawkins run CLI — drive a Playbook-governed agent run"
```

---

### Task 8: Black-box functional e2e (the shipped artifact)

**Files:**

- Test: `packages/core/test-functional/run.e2e.test.ts`

- [ ] **Step 1: Write the functional test**

`packages/core/test-functional/run.e2e.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Black-box: spawn the actual built CLI a user runs, assert on real stdout. Proves the
// whole wiring (ESM resolution, the Agent+Playbook+gates+audit composition, the operator
// loop) survives packaging — exactly as shipped.
const run = promisify(execFile);
const DIST_CLI = "packages/core/dist/bin/run.js";

describe("openhawkins run — functional (black-box)", () => {
  it("drives an unattended Playbook-governed run to completion with a verified audit", async () => {
    const { stdout } = await run("node", [DIST_CLI, "--approve-all", "--json"]);
    const line = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
    const out = JSON.parse(line) as {
      result: { kind: string };
      auditEntries: number;
      auditVerified: boolean;
    };
    expect(out.result.kind).toBe("completed");
    expect(out.auditVerified).toBe(true);
    expect(out.auditEntries).toBeGreaterThan(6); // phase transitions + the agent's grounded turn
  });
});
```

This one black-box test deterministically proves the shipped wiring works (no TTY needed —
`--approve-all` uses a `ScriptedOperator`). The interactive `HumanOperator` line-handling is
already unit-tested in Task 3; spawning a TTY here would add flakiness for no extra coverage.

- [ ] **Step 3: Build, then run the functional suite**

Run: `npm run build && npm run test:functional`
Expected: the new `run.e2e.test.ts` PASSES alongside the existing functional tests.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test-functional/run.e2e.test.ts
git commit -m "test(playbook): black-box functional e2e for the openhawkins run CLI"
```

---

### Task 9: The full gate

- [ ] **Step 1: Run the FULL repo gate**

Run: `npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional`
Expected: all green; aggregate ≥99%; every new `packages/core/src/playbook/*.ts` at 100% (`bin/run.ts` is coverage-excluded). If `format:check` complains, run `npm run format` first. Paste the coverage table tail (the `All files` line + the `playbook/` rows).

- [ ] **Step 2: Run the Docker gate (the required PR check)**

Run: `docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test`
Expected: ends with `✅ ALL GATES PASSED`. If docker is unavailable, report explicitly.

- [ ] **Step 3: Commit (if `npm run format` changed anything)**

```bash
git add -A
git commit -m "chore(playbook): formatting for AgentRun integration" || echo "nothing to commit"
```

---

## Self-Review (coverage of the spec)

- **Spec §3.1/§3.2 — `AgentRun` types + run loop:** Task 1 (core) + Task 2 (robustness matrix). ✓
- **Spec §3.3 — operators (Human + a test fake):** Task 3 (`HumanOperator` injectable IO + `ScriptedOperator`). ✓
- **Spec §3.4 — production wiring + real-gate Validate (injected):** Task 4 (`buildAgentRun`, real gate default) + Task 7 (CLI). ✓
- **Spec §4 — handler-throw surfaces; escalation/decline are structured results; denied-override halts:** Task 2 covers all. ✓
- **Spec §6 — event/audit-sequence tests for clean/replan/escalation/decline/throw/denied + a real-Agent integration:** Task 2 (unit) + Task 4 (real Agent) + Task 6 (full-stack matrix incl. replay determinism + unified audit verify). ✓
- **The requested robust end-to-end automation:** Task 6 (in-process full-stack robustness suite) + Task 8 (black-box functional CLI e2e). ✓
- **Type consistency:** `PhaseHandler`, `Operator`, `OperatorDecision`, `AgentRunResult`, `AgentRunDeps`, `AgentRun`, `ScriptedOperator`, `HumanOperator`, `HumanOperatorIo`, `buildAgentRun`, `BuildAgentRunOpts`, `BuiltAgentRun` — used identically across tasks; reuse `PlaybookRun`/`Phase`/`PhaseGate`/`ValidateGate`/`gateCommandPredicate`/`Agent` unchanged. ✓

---

## Landing note

This is one cohesive increment ("wire `PlaybookRun` into a real agent run + prove it end to
end"). It can land as a single PR, or be split after Task 5 (orchestrator + operators +
factory) from Tasks 6–9 (the e2e automation + CLI) if a smaller review is preferred. Either
way every task is independently reviewable and behind the same gate.
