# Playbook P3 — Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `PlaybookRun` — the single-writer driver that turns the pure `step` transitions into committed `PhaseEvent`s + hash-chained Murray audit entries, resolves each phase's gate, and enforces a capability-gated, audited operator override.

**Architecture:** One new file `packages/core/src/playbook/runner.ts` (plus one line added to `security/capability.ts` for a new `playbook:override` capability). `PlaybookRun` composes the merged P1/P2 pieces: it folds state with `reducePlaybook`, decides transitions with `step`, evaluates `SoftGate`/`ValidateGate` per `PhaseSpec.gate`, appends events to a VINES `EventStore`, audits every event + every denied override through a Murray `AuditLog`, and gates overrides with `grantSatisfies`. It is the IO layer; all logic it drives is already pure and tested.

**Tech Stack:** TypeScript (strict: `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM with `.js` import specifiers, Vitest, Node 24 + Bun 1.3. Prettier printWidth 100, double quotes.

**Spec:** [`docs/specs/2026-06-09-playbook-process-engine-design.md`](../specs/2026-06-09-playbook-process-engine-design.md) — milestone **P3** (§3.6, §3.7, §8).

**Depends on (merged P1 + P2):**

- `manifest.ts` — `Phase`, `PlaybookManifest`, `phaseSpec(manifest, phase)`, `nextPhase(manifest, phase): Phase | undefined`.
- `events.ts` — `PhaseEvent` (the four variants), `PlaybookRunState{phase, replans}`, `reducePlaybook(state, event)`.
- `machine.ts` — `step(manifest, state, verdict): { next, outcome }`, `GateVerdict`.
- `gates.ts` — `PhaseGate{evaluate(ctx): Promise<GateVerdict>}`, `GateContext{phase}`, `SoftGate`, `ValidateGate`.
- `session/events.ts` — `EventStore{append, read}` (the `DomainEvent` union includes `PhaseEvent`), `InMemoryEventStore`.
- `security/audit.ts` — `AuditLog{append(input), entries(), verify()}`, `InMemoryAuditLog`.
- `security/capability.ts` — `CapabilityName` union, `AgentGrant`, `grantSatisfies(grant, required)`.
- `util/clock.ts` — `Clock = () => number`, `systemClock`, `fixedClock(start)`.

**Conventions to follow (read before starting):**

- Tests at `packages/core/test/playbook/<name>.test.ts`; import source as `../../src/playbook/<name>.js`.
- ESM imports use `.js` specifiers. Coverage ≥99%; every new file 100% — real behavior tests.
- The runner is a **single writer** (like `session/session.ts`): each public method awaits its own event commits in order; tests drive it sequentially.
- No spawning / real IO in tests — inject fake `PhaseGate`s (return a fixed `GateVerdict`) and use `InMemoryEventStore` + `InMemoryAuditLog` + `fixedClock`.

---

### Task 1: Add the `playbook:override` capability

**Files:**

- Modify: `packages/core/src/security/capability.ts` (extend the `CapabilityName` union)
- Test: `packages/core/test/security/capability.test.ts` (add one assertion)

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/security/capability.test.ts` (inside the existing top-level `describe`, or as a new `describe` — keep existing imports; `grantSatisfies`/types are already imported there):

```ts
describe("playbook:override capability", () => {
  it("is satisfiable by a matching grant and denied by default", () => {
    const granted = { agentId: "op", capabilities: [{ name: "playbook:override" as const }] };
    expect(grantSatisfies(granted, { name: "playbook:override" })).toBe(true);
    const empty = { agentId: "op", capabilities: [] };
    expect(grantSatisfies(empty, { name: "playbook:override" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/security/capability.test.ts`
Expected: FAIL — `"playbook:override"` is not assignable to `CapabilityName`.

- [ ] **Step 3: Extend the union**

In `packages/core/src/security/capability.ts`, add `"playbook:override"` to the `CapabilityName` union:

```ts
export type CapabilityName =
  | "shell"
  | "network"
  | "fs:read"
  | "fs:write"
  | "host:info"
  | "model-call"
  | "playbook:override";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/security/capability.test.ts --coverage.enabled --coverage.include='packages/core/src/security/capability.ts'`
Expected: PASS; `capability.ts` stays 100% (the union is a type; `grantSatisfies` already covered).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/security/capability.ts packages/core/test/security/capability.test.ts
git commit -m "feat(playbook): add playbook:override capability"
```

---

### Task 2: `PlaybookRun` — construction, start, and the commit pipeline

**Files:**

- Create: `packages/core/src/playbook/runner.ts`
- Test: `packages/core/test/playbook/runner.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/playbook/runner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PlaybookRun, type PlaybookRunDeps } from "../../src/playbook/runner.js";
import { DEFAULT_MANIFEST } from "../../src/playbook/manifest.js";
import { SoftGate, ValidateGate, type PhaseGate } from "../../src/playbook/gates.js";
import { isPhaseEvent } from "../../src/playbook/events.js";
import { InMemoryEventStore } from "../../src/session/events.js";
import { InMemoryAuditLog } from "../../src/security/audit.js";
import { fixedClock } from "../../src/util/clock.js";
import type { AgentGrant } from "../../src/security/capability.js";

const OPERATOR: AgentGrant = {
  agentId: "op",
  capabilities: [{ name: "playbook:override" }],
};

/** A gate that always returns the same verdict — stands in for SoftGate/ValidateGate. */
function fakeGate(verdict: Awaited<ReturnType<PhaseGate["evaluate"]>>): PhaseGate {
  return { evaluate: async () => verdict };
}

function deps(overrides: Partial<PlaybookRunDeps> = {}): PlaybookRunDeps {
  return {
    manifest: DEFAULT_MANIFEST,
    sessionId: "s1",
    runId: "r1",
    store: new InMemoryEventStore(),
    audit: new InMemoryAuditLog(),
    grant: OPERATOR,
    softGate: new SoftGate(),
    validateGate: new ValidateGate(async () => ({ ok: true })),
    clock: fixedClock(1000),
    ...overrides,
  };
}

describe("PlaybookRun.start", () => {
  it("enters the manifest's first phase, recording one event and one audit entry", async () => {
    const d = deps();
    const run = await PlaybookRun.start(d);
    expect(run.state).toEqual({ phase: "Research", replans: 0 });
    expect(run.status()).toEqual({ kind: "running", phase: "Research" });

    const events = (await d.store.read("s1")).filter(isPhaseEvent);
    expect(events).toEqual([
      { type: "PhaseEntered", sessionId: "s1", runId: "r1", phase: "Research", at: 1000 },
    ]);

    const audit = await d.audit.entries();
    expect(audit.map((e) => e.kind)).toEqual(["PhaseEntered"]);
    expect(await d.audit.verify()).toBe(true);
  });

  it("throws if the manifest has no phases", async () => {
    await expect(
      PlaybookRun.start(deps({ manifest: { phases: [], maxReplans: 3 } })),
    ).rejects.toThrow(/no phases/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/runner.test.ts`
Expected: FAIL — cannot find module `../../src/playbook/runner.js`.

- [ ] **Step 3: Write `packages/core/src/playbook/runner.ts`**

```ts
import type { EventStore } from "../session/events.js";
import type { AuditLog } from "../security/audit.js";
import { grantSatisfies, type AgentGrant } from "../security/capability.js";
import { type Clock, systemClock } from "../util/clock.js";
import { type PlaybookManifest, type Phase, phaseSpec, nextPhase } from "./manifest.js";
import { type PlaybookRunState, type PhaseEvent, reducePlaybook } from "./events.js";
import { step } from "./machine.js";
import type { PhaseGate } from "./gates.js";

/** Everything a run needs: the manifest, the session/run ids, the VINES store + Murray
 *  audit it writes to, the operator's capability grant, and the two gates it dispatches to. */
export interface PlaybookRunDeps {
  manifest: PlaybookManifest;
  sessionId: string;
  runId: string;
  store: EventStore;
  audit: AuditLog;
  grant: AgentGrant;
  softGate: PhaseGate;
  validateGate: PhaseGate;
  clock?: Clock;
}

/** The externally observable state of a run after an operation. */
export type RunStatus =
  | { kind: "running"; phase: Phase }
  | { kind: "awaiting-operator"; phase: Phase; reason: string }
  | { kind: "escalated"; phase: Phase; reason: string }
  | { kind: "done"; phase: Phase };

const OVERRIDE_CAPABILITY = "playbook:override" as const;

/**
 * The single-writer driver for one Playbook run. It evaluates each phase's gate, applies
 * the pure `step` transition, and commits the resulting `PhaseEvent`s to VINES + Murray
 * (so the run replays and is tamper-evident). Soft phases pause for a capability-gated,
 * audited operator `override`. Methods are awaited in order; one run = one writer.
 */
export class PlaybookRun {
  private _state: PlaybookRunState;
  private _status: RunStatus;

  private constructor(
    private readonly deps: PlaybookRunDeps,
    private readonly clock: Clock,
    startPhase: Phase,
  ) {
    this._state = { phase: startPhase, replans: 0 };
    this._status = { kind: "running", phase: startPhase };
  }

  /** Begin a run: enter the manifest's first phase (one committed + audited event). */
  static async start(deps: PlaybookRunDeps): Promise<PlaybookRun> {
    const first = deps.manifest.phases[0];
    if (first === undefined) {
      throw new Error("PlaybookRun.start: manifest has no phases");
    }
    const run = new PlaybookRun(deps, deps.clock ?? systemClock, first.phase);
    await run.enter(first.phase);
    return run;
  }

  get state(): PlaybookRunState {
    return this._state;
  }

  status(): RunStatus {
    return this._status;
  }

  /** Signal the current phase complete: evaluate its gate and apply the transition. */
  async advance(): Promise<RunStatus> {
    const phase = this._state.phase;
    if (nextPhase(this.deps.manifest, phase) === undefined) {
      this._status = { kind: "done", phase };
      return this._status;
    }
    const spec = phaseSpec(this.deps.manifest, phase);
    const gate = spec.gate === "validate" ? this.deps.validateGate : this.deps.softGate;
    const verdict = await gate.evaluate({ phase });
    const transition = step(this.deps.manifest, this._state, verdict);
    const reason = "reason" in verdict ? verdict.reason : "";
    switch (transition.outcome) {
      case "advanced":
        await this.commit(this.gatePassed(phase));
        await this.enter(transition.next.phase);
        this._status = this.statusForPhase(transition.next.phase);
        break;
      case "replan":
        await this.commit(this.gateFailed(phase, reason, false));
        await this.enter(transition.next.phase);
        this._status = { kind: "running", phase: transition.next.phase };
        break;
      case "escalated":
        await this.commit(this.gateFailed(phase, reason, true));
        this._status = { kind: "escalated", phase, reason };
        break;
      case "paused":
        this._status = { kind: "awaiting-operator", phase, reason };
        break;
      case "noop":
        this._status = { kind: "done", phase };
        break;
    }
    return this._status;
  }

  /**
   * Operator override of the current phase. Capability-gated (`playbook:override`) and
   * audited either way: a denied attempt records a `PhaseOverrideDenied` audit entry and
   * changes nothing; a granted override commits `PhaseOverridden` then advances as if the
   * gate had passed.
   */
  async override(actor: string, reason: string): Promise<RunStatus> {
    const phase = this._state.phase;
    if (nextPhase(this.deps.manifest, phase) === undefined) {
      this._status = { kind: "done", phase };
      return this._status;
    }
    if (!grantSatisfies(this.deps.grant, { name: OVERRIDE_CAPABILITY })) {
      await this.deps.audit.append({
        kind: "PhaseOverrideDenied",
        data: { phase, actor, reason, runId: this.deps.runId },
        at: this.clock(),
      });
      return this._status;
    }
    await this.commit({
      type: "PhaseOverridden",
      sessionId: this.deps.sessionId,
      runId: this.deps.runId,
      phase,
      actor,
      reason,
      at: this.clock(),
    });
    const transition = step(this.deps.manifest, this._state, { status: "passed" });
    await this.enter(transition.next.phase);
    this._status = this.statusForPhase(transition.next.phase);
    return this._status;
  }

  private statusForPhase(phase: Phase): RunStatus {
    return nextPhase(this.deps.manifest, phase) === undefined
      ? { kind: "done", phase }
      : { kind: "running", phase };
  }

  private gatePassed(phase: Phase): PhaseEvent {
    return {
      type: "PhaseGatePassed",
      sessionId: this.deps.sessionId,
      runId: this.deps.runId,
      phase,
      at: this.clock(),
    };
  }

  private gateFailed(phase: Phase, reason: string, escalate: boolean): PhaseEvent {
    return {
      type: "PhaseGateFailed",
      sessionId: this.deps.sessionId,
      runId: this.deps.runId,
      phase,
      reason,
      escalate,
      at: this.clock(),
    };
  }

  private async enter(phase: Phase): Promise<void> {
    await this.commit({
      type: "PhaseEntered",
      sessionId: this.deps.sessionId,
      runId: this.deps.runId,
      phase,
      at: this.clock(),
    });
  }

  /** Append to VINES, mirror to Murray, fold into local state — in that order. */
  private async commit(event: PhaseEvent): Promise<void> {
    await this.deps.store.append(event);
    await this.deps.audit.append({ kind: event.type, data: { ...event }, at: event.at });
    this._state = reducePlaybook(this._state, event);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/playbook/runner.test.ts`
Expected: PASS (2 tests). Coverage is completed in Tasks 3-4; do not measure per-file 100% yet (advance/override are exercised next).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/playbook/runner.ts packages/core/test/playbook/runner.test.ts
git commit -m "feat(playbook): PlaybookRun start + commit pipeline (VINES + Murray)"
```

---

### Task 3: `advance` — every transition outcome

**Files:**

- Modify: `packages/core/test/playbook/runner.test.ts` (add an `advance` describe block)

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/playbook/runner.test.ts`:

```ts
const phasesOf = async (store: InMemoryEventStore): Promise<string[]> =>
  (await store.read("s1")).filter(isPhaseEvent).map((e) => `${e.type}:${e.phase}`);

describe("PlaybookRun.advance", () => {
  it("a passed gate advances and records GatePassed + Entered", async () => {
    const d = deps({ softGate: fakeGate({ status: "passed" }) });
    const run = await PlaybookRun.start(d);
    const status = await run.advance();
    expect(status).toEqual({ kind: "running", phase: "Plan" });
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual([
      "PhaseEntered:Research",
      "PhaseGatePassed:Research",
      "PhaseEntered:Plan",
    ]);
    expect(await d.audit.verify()).toBe(true);
  });

  it("a soft gate pauses the run awaiting an operator (no new events)", async () => {
    const d = deps(); // real SoftGate -> needs-operator
    const run = await PlaybookRun.start(d);
    const status = await run.advance();
    expect(status.kind).toBe("awaiting-operator");
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual(["PhaseEntered:Research"]);
  });

  it("a failed Validate replans to Plan, recording GateFailed(escalate:false) + Entered", async () => {
    const d = deps({ validateGate: fakeGate({ status: "failed", reason: "coverage 98%" }) });
    const run = await PlaybookRun.start(d);
    // drive to Validate via passed soft gates would need overrides; instead seed by overriding
    await run.override("op", "skip research"); // Research -> Plan
    await run.override("op", "skip plan"); // Plan -> Tasks
    await run.override("op", "skip tasks"); // Tasks -> Execute
    await run.override("op", "skip execute"); // Execute -> Validate
    expect(run.state.phase).toBe("Validate");
    const status = await run.advance(); // Validate fails
    expect(status).toEqual({ kind: "running", phase: "Plan" });
    expect(run.state).toEqual({ phase: "Plan", replans: 1 });
    const events = await phasesOf(d.store as InMemoryEventStore);
    expect(events).toContain("PhaseGateFailed:Validate");
    expect(events[events.length - 1]).toBe("PhaseEntered:Plan");
    expect(await d.audit.verify()).toBe(true);
  });

  it("escalates when the replan budget is exhausted", async () => {
    const d = deps({
      manifest: { ...DEFAULT_MANIFEST, maxReplans: 0 },
      validateGate: fakeGate({ status: "failed", reason: "still red" }),
    });
    const run = await PlaybookRun.start(d);
    await run.override("op", "to plan"); // Research -> Plan
    await run.override("op", "to tasks"); // Plan -> Tasks
    await run.override("op", "to execute"); // Tasks -> Execute
    await run.override("op", "to validate"); // Execute -> Validate
    const status = await run.advance(); // fails; replans (0+1) > maxReplans (0) -> escalate
    expect(status).toEqual({ kind: "escalated", phase: "Validate", reason: "still red" });
    const events = await phasesOf(d.store as InMemoryEventStore);
    expect(events[events.length - 1]).toBe("PhaseGateFailed:Validate");
    expect(await d.audit.verify()).toBe(true);
  });

  it("advancing at the terminal phase is a no-op returning done", async () => {
    const d = deps({ validateGate: fakeGate({ status: "passed" }) });
    const run = await PlaybookRun.start(d);
    for (let i = 0; i < 4; i++) await run.override("op", "skip"); // -> Validate
    await run.advance(); // Validate passed -> Present (done)
    expect(run.status()).toEqual({ kind: "done", phase: "Present" });
    const before = (await (d.store as InMemoryEventStore).read("s1")).length;
    expect(await run.advance()).toEqual({ kind: "done", phase: "Present" });
    const after = (await (d.store as InMemoryEventStore).read("s1")).length;
    expect(after).toBe(before); // no new events at terminal
  });
});
```

- [ ] **Step 2: Run test to verify it fails (then passes)**

Run: `npx vitest run packages/core/test/playbook/runner.test.ts`
Expected: these new tests PASS against the Task 2 implementation (no source change needed — `advance`/`override` already exist). If any fails, fix the test to match the implemented behavior, not the reverse, unless the implementation is genuinely wrong.

- [ ] **Step 3: Verify coverage of `runner.ts`**

Run: `npx vitest run packages/core/test/playbook/runner.test.ts --coverage.enabled --coverage.include='packages/core/src/playbook/runner.ts'`
Expected: `advanced` (both running + the `statusForPhase` done arm via the terminal test), `replan`, `escalated`, `paused`, `noop`, and the `"reason" in verdict` true/false arms are all covered. The `override` path is partially covered here (used to seed); Task 4 finishes it. Report the exact per-file numbers; if a branch is uncovered, note which.

- [ ] **Step 4: Commit**

```bash
git add packages/core/test/playbook/runner.test.ts
git commit -m "test(playbook): cover every advance() transition outcome"
```

---

### Task 4: `override` — granted and denied, then the full gate

**Files:**

- Modify: `packages/core/test/playbook/runner.test.ts` (add an `override` describe block)
- Modify: `packages/core/src/playbook/index.ts` (re-export the runner)
- Test: `packages/core/test/playbook/index.test.ts` (extend the barrel assertion)

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/playbook/runner.test.ts`:

```ts
describe("PlaybookRun.override", () => {
  it("a granted override advances a paused soft phase, recording PhaseOverridden", async () => {
    const d = deps(); // SoftGate pauses Research; OPERATOR holds playbook:override
    const run = await PlaybookRun.start(d);
    await run.advance(); // -> awaiting-operator at Research
    const status = await run.override("alice", "spikes done");
    expect(status).toEqual({ kind: "running", phase: "Plan" });
    const events = await phasesOf(d.store as InMemoryEventStore);
    expect(events).toEqual([
      "PhaseEntered:Research",
      "PhaseOverridden:Research",
      "PhaseEntered:Plan",
    ]);
    expect(await d.audit.verify()).toBe(true);
  });

  it("a denied override (no capability) changes nothing but audits the attempt", async () => {
    const noGrant: AgentGrant = { agentId: "op", capabilities: [] };
    const d = deps({ grant: noGrant });
    const run = await PlaybookRun.start(d);
    await run.advance(); // awaiting-operator at Research
    const status = await run.override("mallory", "skip it");
    expect(status.kind).toBe("awaiting-operator");
    expect(run.state).toEqual({ phase: "Research", replans: 0 });
    // no new PhaseEvent, but a denial audit entry exists
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual(["PhaseEntered:Research"]);
    const audit = await d.audit.entries();
    expect(audit.map((e) => e.kind)).toContain("PhaseOverrideDenied");
    expect(await d.audit.verify()).toBe(true);
  });

  it("a granted override of the final pre-terminal phase finishes the run", async () => {
    const d = deps({ validateGate: fakeGate({ status: "passed" }) });
    const run = await PlaybookRun.start(d);
    for (let i = 0; i < 4; i++) await run.override("op", "skip"); // -> Validate
    await run.advance(); // Validate passed -> Present
    // overriding at terminal Present is a no-op done
    expect(await run.override("op", "noop")).toEqual({ kind: "done", phase: "Present" });
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run packages/core/test/playbook/runner.test.ts`
Expected: PASS (all runner tests). Then confirm `runner.ts` 100%:
`npx vitest run packages/core/test/playbook/runner.test.ts --coverage.enabled --coverage.include='packages/core/src/playbook/runner.ts'`
Expected: 100% across stmts/branch/funcs/lines (the granted/denied override branches, the terminal-override no-op, and `statusForPhase` both arms are now all covered). If a branch is uncovered, add a focused test.

- [ ] **Step 3: Extend the barrel + its test**

In `packages/core/test/playbook/index.test.ts`, add inside the existing `it("re-exports …")` body:

```ts
expect(typeof playbook.PlaybookRun).toBe("function");
```

Then `packages/core/src/playbook/index.ts` becomes:

```ts
export * from "./manifest.js";
export * from "./events.js";
export * from "./machine.js";
export * from "./gates.js";
export * from "./gate-command.js";
export * from "./runner.js";
```

- [ ] **Step 4: Run the barrel test**

Run: `npx vitest run packages/core/test/playbook/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the FULL repo gate**

Run: `npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional`
Expected: all green; aggregate ≥99%, every `packages/core/src/playbook/*.ts` at 100%. If `format:check` complains, run `npm run format` first. Paste the coverage table tail (the `All files` line + all `playbook/` rows). If a pre-existing untouched file is below threshold, STOP and report.

- [ ] **Step 6: Run the Docker gate (the required PR check)**

Run: `docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test`
Expected: ends with `✅ ALL GATES PASSED`. If docker is unavailable, report explicitly.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/playbook/index.ts packages/core/test/playbook/index.test.ts packages/core/test/playbook/runner.test.ts
git commit -m "feat(playbook): export PlaybookRun; P3 runner complete"
```

---

## Self-Review (coverage of the spec — P3 portion)

- **Spec §3.6 — overrides are capability-gated (`playbook:override`) + audited; a denied attempt is audited:** Task 1 (capability) + Task 4 (`override` granted/denied, `PhaseOverrideDenied` audit). ✓
- **Spec §3.7 — data flow: gate → `step` → emit events + audit; advanced/replan/escalated/paused map to the right events:** Task 2 (`commit` pipeline + `start`) + Task 3 (`advance` all outcomes). ✓
- **Spec §3.2/§4 — Validate-fail → Plan; budget exhaustion → escalate (pause):** Task 3 (replan + escalate tests via a failing `ValidateGate`). ✓
- **Spec §3.3 — every transition is a committed `DomainEvent`; current phase is a fold:** `commit` appends `PhaseEvent`s and folds via `reducePlaybook`; tests assert the exact event sequence + `audit.verify()`. ✓
- **Spec §5 — composes VINES (`EventStore`), Murray (`AuditLog`), The Lab (`grantSatisfies`):** the runner imports and uses each; no parallels invented. ✓
- **Spec §6 — behavior-level tests asserting the emitted event sequence + audit chain (`verify() === true`) for clean run, replan, escalation, granted + denied override:** Tasks 2-4. ✓
- **Type consistency:** `PlaybookRunDeps`, `RunStatus`, `PlaybookRun`, `OVERRIDE_CAPABILITY`, and the reused `PhaseEvent`/`PlaybookRunState`/`step`/`PhaseGate`/`grantSatisfies`/`AuditLog`/`EventStore` names are used identically across tasks and tests. ✓

---

## Completes the Playbook

After P3 lands, the Playbook engine is feature-complete per the design: a replayable, audited, capability-gated phase machine. Remaining work is **integration** (deferred, spec §7): wiring `PlaybookRun` into a real agent run / the S3 orchestrator, and the operator-override surface (CLI/API/channel) — each its own future spec → plan → PR.
