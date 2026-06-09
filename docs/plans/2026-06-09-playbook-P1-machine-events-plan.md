# Playbook P1 — Machine + Events (pure core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, IO-free core of the Playbook process engine — the phase manifest, the PhaseTransition domain events + their fold into session state, and the pure transition machine — so a later milestone can wrap them in a runner.

**Architecture:** A new `packages/core/src/playbook/` module. `manifest.ts` declares the phases and the default Playbook (the CLAUDE.md spine). `events.ts` defines four `PhaseEvent` `DomainEvent` variants and the pure reducer that folds them into a `PlaybookRunState`. The session's existing `DomainEvent` union and `reduceEvent` fold are extended to carry that state (via a type-guard delegation, so the existing four cases stay exhaustive). `machine.ts` is a pure `step(manifest, state, verdict) → transition` function with no IO. Everything is unit-tested to 100%.

**Tech Stack:** TypeScript (strict: `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`), ESM with `.js` import specifiers, Vitest, Node 24 + Bun 1.3. Prettier printWidth 100, double quotes.

**Spec:** [`docs/specs/2026-06-09-playbook-process-engine-design.md`](../specs/2026-06-09-playbook-process-engine-design.md) — this plan implements milestone **P1** (§8).

**Conventions to follow (read before starting):**

- Tests live at `packages/core/test/playbook/<name>.test.ts` and import source as `../../src/playbook/<name>.js`.
- Every cross-file import uses a `.js` specifier even though the files are `.ts`.
- The coverage gate is **≥99% across all metrics**; each new file must be 100%. Earn it with real behavior tests, never by gaming.
- This milestone adds **no IO** — no file/network/db access, no `EventStore` usage. It only defines types, pure reducers, and a pure transition function.

---

### Task 1: Phase manifest + default Playbook

**Files:**

- Create: `packages/core/src/playbook/manifest.ts`
- Test: `packages/core/test/playbook/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/playbook/manifest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  DEFAULT_MANIFEST,
  phaseSpec,
  nextPhase,
  type PlaybookManifest,
} from "../../src/playbook/manifest.js";

describe("playbook manifest", () => {
  it("default manifest is the CLAUDE.md spine with a Validate->Plan onFail", () => {
    expect(DEFAULT_MANIFEST.phases.map((p) => p.phase)).toEqual([
      "Research",
      "Plan",
      "Tasks",
      "Execute",
      "Validate",
      "Present",
    ]);
    expect(phaseSpec(DEFAULT_MANIFEST, "Validate").gate).toBe("validate");
    expect(phaseSpec(DEFAULT_MANIFEST, "Validate").onFail).toBe("Plan");
    expect(phaseSpec(DEFAULT_MANIFEST, "Research").gate).toBe("soft");
    expect(DEFAULT_MANIFEST.maxReplans).toBe(3);
  });

  it("nextPhase returns the sequential successor, or undefined at the terminal phase", () => {
    expect(nextPhase(DEFAULT_MANIFEST, "Research")).toBe("Plan");
    expect(nextPhase(DEFAULT_MANIFEST, "Execute")).toBe("Validate");
    expect(nextPhase(DEFAULT_MANIFEST, "Validate")).toBe("Present");
    expect(nextPhase(DEFAULT_MANIFEST, "Present")).toBeUndefined();
  });

  it("phaseSpec throws for a phase not in the manifest", () => {
    const tiny: PlaybookManifest = {
      phases: [{ phase: "Research", gate: "soft" }],
      maxReplans: 1,
    };
    expect(() => phaseSpec(tiny, "Validate")).toThrow(/not in manifest/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/manifest.test.ts`
Expected: FAIL — cannot find module `../../src/playbook/manifest.js`.

- [ ] **Step 3: Write `packages/core/src/playbook/manifest.ts`**

```ts
/** The fixed phases of the working process (CLAUDE.md spine). */
export type Phase = "Research" | "Plan" | "Tasks" | "Execute" | "Validate" | "Present";

/** How a phase decides it is complete. `soft` pauses for an operator override;
 *  `validate` runs an injected predicate (P2). `Present` is terminal. */
export type GateKind = "soft" | "validate";

export interface PhaseSpec {
  phase: Phase;
  gate: GateKind;
  /** Where a failed gate routes. Only meaningful for the `validate` gate. */
  onFail?: Phase;
}

export interface PlaybookManifest {
  /** Ordered; the first is the start phase, the last is terminal. */
  phases: PhaseSpec[];
  /** Max Validate->Plan replans before a run escalates to an operator. */
  maxReplans: number;
}

/** The built-in default Playbook: the CLAUDE.md Research->...->Present spine. */
export const DEFAULT_MANIFEST: PlaybookManifest = {
  phases: [
    { phase: "Research", gate: "soft" },
    { phase: "Plan", gate: "soft" },
    { phase: "Tasks", gate: "soft" },
    { phase: "Execute", gate: "soft" },
    { phase: "Validate", gate: "validate", onFail: "Plan" },
    { phase: "Present", gate: "soft" },
  ],
  maxReplans: 3,
};

/** The spec for `phase`, or throw if the manifest does not declare it. */
export function phaseSpec(manifest: PlaybookManifest, phase: Phase): PhaseSpec {
  const spec = manifest.phases.find((p) => p.phase === phase);
  if (spec === undefined) {
    throw new Error(`phase "${phase}" is not in manifest`);
  }
  return spec;
}

/** The sequential successor of `phase`, or undefined when `phase` is terminal. */
export function nextPhase(manifest: PlaybookManifest, phase: Phase): Phase | undefined {
  const i = manifest.phases.findIndex((p) => p.phase === phase);
  const next = i >= 0 ? manifest.phases[i + 1] : undefined;
  return next?.phase;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/playbook/manifest.test.ts --coverage.enabled --coverage.include='packages/core/src/playbook/manifest.ts'`
Expected: PASS (3 tests); `manifest.ts` 100% across stmts/branch/funcs/lines.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/playbook/manifest.ts packages/core/test/playbook/manifest.test.ts
git commit -m "feat(playbook): phase manifest + default Playbook (CLAUDE.md spine)"
```

---

### Task 2: PhaseTransition events + the PlaybookRunState fold

**Files:**

- Create: `packages/core/src/playbook/events.ts`
- Test: `packages/core/test/playbook/events.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/playbook/events.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  isPhaseEvent,
  reducePlaybook,
  foldPlaybook,
  type PhaseEvent,
  type PlaybookRunState,
} from "../../src/playbook/events.js";
import type { Phase } from "../../src/playbook/manifest.js";

const entered = (phase: Phase): PhaseEvent => ({
  type: "PhaseEntered",
  sessionId: "s1",
  runId: "r1",
  phase,
  at: 1,
});

describe("isPhaseEvent", () => {
  it("recognizes the four phase-event types and rejects others", () => {
    expect(isPhaseEvent({ type: "PhaseEntered" })).toBe(true);
    expect(isPhaseEvent({ type: "PhaseGatePassed" })).toBe(true);
    expect(isPhaseEvent({ type: "PhaseGateFailed" })).toBe(true);
    expect(isPhaseEvent({ type: "PhaseOverridden" })).toBe(true);
    expect(isPhaseEvent({ type: "TurnStarted" })).toBe(false);
  });
});

describe("reducePlaybook", () => {
  const start: PlaybookRunState = { phase: "Research", replans: 0 };

  it("PhaseEntered moves to the entered phase", () => {
    expect(reducePlaybook(start, entered("Plan"))).toEqual({ phase: "Plan", replans: 0 });
  });

  it("PhaseGateFailed increments the replan counter without moving", () => {
    const e: PhaseEvent = {
      type: "PhaseGateFailed",
      sessionId: "s1",
      runId: "r1",
      phase: "Validate",
      reason: "red",
      escalate: false,
      at: 2,
    };
    expect(reducePlaybook({ phase: "Validate", replans: 0 }, e)).toEqual({
      phase: "Validate",
      replans: 1,
    });
  });

  it("PhaseGatePassed and PhaseOverridden are records that do not change state", () => {
    const passed: PhaseEvent = {
      type: "PhaseGatePassed",
      sessionId: "s1",
      runId: "r1",
      phase: "Validate",
      at: 3,
    };
    const overridden: PhaseEvent = {
      type: "PhaseOverridden",
      sessionId: "s1",
      runId: "r1",
      phase: "Research",
      actor: "alice",
      reason: "spikes done",
      at: 4,
    };
    expect(reducePlaybook(start, passed)).toEqual(start);
    expect(reducePlaybook(start, overridden)).toEqual(start);
  });
});

describe("foldPlaybook", () => {
  it("replays a clean run to the terminal phase", () => {
    const log: PhaseEvent[] = [
      entered("Research"),
      entered("Plan"),
      entered("Tasks"),
      entered("Execute"),
      entered("Validate"),
      entered("Present"),
    ];
    expect(foldPlaybook(log)).toEqual({ phase: "Present", replans: 0 });
  });

  it("counts replans across a Validate failure loop", () => {
    const fail: PhaseEvent = {
      type: "PhaseGateFailed",
      sessionId: "s1",
      runId: "r1",
      phase: "Validate",
      reason: "red",
      escalate: false,
      at: 9,
    };
    expect(foldPlaybook([entered("Validate"), fail, entered("Plan")])).toEqual({
      phase: "Plan",
      replans: 1,
    });
  });

  it("seeds the start phase from the first PhaseEntered when given no seed", () => {
    expect(foldPlaybook([entered("Research")])).toEqual({ phase: "Research", replans: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/events.test.ts`
Expected: FAIL — cannot find module `../../src/playbook/events.js`.

- [ ] **Step 3: Write `packages/core/src/playbook/events.ts`**

```ts
import type { Phase } from "./manifest.js";

/** The PhaseTransition domain events. Appended to the VINES event store (the session
 *  `DomainEvent` union includes these); the current run state is a fold over them. */
export type PhaseEvent =
  | { type: "PhaseEntered"; sessionId: string; runId: string; phase: Phase; at: number }
  | { type: "PhaseGatePassed"; sessionId: string; runId: string; phase: Phase; at: number }
  | {
      type: "PhaseGateFailed";
      sessionId: string;
      runId: string;
      phase: Phase;
      reason: string;
      escalate: boolean;
      at: number;
    }
  | {
      type: "PhaseOverridden";
      sessionId: string;
      runId: string;
      phase: Phase;
      actor: string;
      reason: string;
      at: number;
    };

/** The folded state of a Playbook run: where it is and how many times it has replanned. */
export interface PlaybookRunState {
  phase: Phase;
  replans: number;
}

const PHASE_EVENT_TYPES = new Set([
  "PhaseEntered",
  "PhaseGatePassed",
  "PhaseGateFailed",
  "PhaseOverridden",
]);

/** True when `e` is one of the four PhaseTransition events. */
export function isPhaseEvent(e: { type: string }): e is PhaseEvent {
  return PHASE_EVENT_TYPES.has(e.type);
}

/** Fold one phase event into the run state. Pure. */
export function reducePlaybook(state: PlaybookRunState, e: PhaseEvent): PlaybookRunState {
  switch (e.type) {
    case "PhaseEntered":
      return { ...state, phase: e.phase };
    case "PhaseGateFailed":
      return { ...state, replans: state.replans + 1 };
    case "PhaseGatePassed":
    case "PhaseOverridden":
      return state;
  }
}

/** Fold a phase-event log into a run state. The start phase is seeded from the first
 *  event's `phase` (the runner always emits `PhaseEntered(start)` first). */
export function foldPlaybook(events: readonly PhaseEvent[]): PlaybookRunState {
  if (events.length === 0) {
    throw new Error("foldPlaybook: empty event log");
  }
  const seed: PlaybookRunState = { phase: events[0].phase, replans: 0 };
  return events.reduce(reducePlaybook, seed);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/playbook/events.test.ts --coverage.enabled --coverage.include='packages/core/src/playbook/events.ts'`
Expected: PASS (7 tests); `events.ts` 100%. (The empty-log throw in `foldPlaybook` is covered by adding the assertion below if v8 flags it.)

> If coverage flags the `events.length === 0` throw branch as uncovered, add this test to `events.test.ts` under the `foldPlaybook` describe:
>
> ```ts
> it("throws on an empty log", () => {
>   expect(() => foldPlaybook([])).toThrow(/empty event log/);
> });
> ```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/playbook/events.ts packages/core/test/playbook/events.test.ts
git commit -m "feat(playbook): PhaseTransition events + PlaybookRunState fold"
```

---

### Task 3: Wire PhaseEvent into the session DomainEvent union + fold

**Files:**

- Modify: `packages/core/src/session/events.ts` (add `| PhaseEvent` to the `DomainEvent` union)
- Modify: `packages/core/src/session/state.ts` (carry `PlaybookRunState` in `SessionState`; delegate phase events)
- Test: `packages/core/test/session/state.test.ts` (extend — add a playbook-delegation describe block)

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `packages/core/test/session/state.test.ts` (keep the existing imports; add the two named imports shown):

```ts
import { foldEvents } from "../../src/session/state.js";
import type { PhaseEvent } from "../../src/playbook/events.js";

describe("session state — playbook phase events", () => {
  const base = { sessionId: "s1", runId: "r1", at: 1 } as const;

  it("folds phase events into SessionState.playbook", () => {
    const events: DomainEvent[] = [
      { type: "SessionStarted", sessionId: "s1", agentId: "a1", at: 0 },
      { type: "PhaseEntered", ...base, phase: "Research" },
      { type: "PhaseEntered", ...base, phase: "Plan" },
    ];
    expect(foldEvents(events).playbook).toEqual({ phase: "Plan", replans: 0 });
  });

  it("counts a Validate failure in SessionState.playbook.replans", () => {
    const events: DomainEvent[] = [
      { type: "PhaseEntered", ...base, phase: "Validate" },
      {
        type: "PhaseGateFailed",
        ...base,
        phase: "Validate",
        reason: "red",
        escalate: false,
      },
      { type: "PhaseEntered", ...base, phase: "Plan" },
    ];
    expect(foldEvents(events).playbook).toEqual({ phase: "Plan", replans: 1 });
  });

  it("leaves playbook undefined when no phase events have occurred", () => {
    const events: DomainEvent[] = [
      { type: "SessionStarted", sessionId: "s1", agentId: "a1", at: 0 },
    ];
    expect(foldEvents(events).playbook).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/session/state.test.ts`
Expected: FAIL — `PhaseEntered`/`PhaseGateFailed` are not assignable to `DomainEvent` (union does not include them yet), and `.playbook` does not exist on `SessionState`.

- [ ] **Step 3a: Extend the `DomainEvent` union**

In `packages/core/src/session/events.ts`, add the import and the union arm. The file becomes:

```ts
import type { PhaseEvent } from "../playbook/events.js";

export type DomainEvent =
  | { type: "SessionStarted"; sessionId: string; agentId: string; at: number }
  | { type: "TurnStarted"; sessionId: string; turnId: string; input: string; at: number }
  | { type: "TurnEnded"; sessionId: string; turnId: string; final: string; at: number }
  | { type: "TurnFailed"; sessionId: string; turnId: string; error: string; at: number }
  | PhaseEvent;

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  read(sessionId: string): Promise<DomainEvent[]>;
}

export class InMemoryEventStore implements EventStore {
  private readonly log: DomainEvent[] = [];

  async append(event: DomainEvent): Promise<void> {
    this.log.push(event);
  }

  async read(sessionId: string): Promise<DomainEvent[]> {
    return this.log.filter((e) => e.sessionId === sessionId);
  }
}
```

(`InMemoryEventStore.read` filters on `e.sessionId`; every `PhaseEvent` carries `sessionId`, so this keeps compiling unchanged.)

- [ ] **Step 3b: Carry playbook state in the session fold**

In `packages/core/src/session/state.ts`, add the import, extend `SessionState`, and delegate phase events with a type guard so the existing four cases stay exhaustive. The file becomes:

```ts
import type { DomainEvent } from "./events.js";
import { isPhaseEvent, reducePlaybook, type PlaybookRunState } from "../playbook/events.js";

export interface TurnState {
  id: string;
  input: string;
  final?: string;
  error?: string;
}

export interface SessionState {
  agentId?: string;
  turns: TurnState[];
  /** Present once the run's first phase event has been folded. */
  playbook?: PlaybookRunState;
}

export function initialState(): SessionState {
  return { turns: [] };
}

export function reduceEvent(state: SessionState, event: DomainEvent): SessionState {
  if (isPhaseEvent(event)) {
    const prev: PlaybookRunState = state.playbook ?? { phase: event.phase, replans: 0 };
    return { ...state, playbook: reducePlaybook(prev, event) };
  }
  switch (event.type) {
    case "SessionStarted":
      return { ...state, agentId: event.agentId };
    case "TurnStarted":
      return { ...state, turns: [...state.turns, { id: event.turnId, input: event.input }] };
    case "TurnEnded":
      return {
        ...state,
        turns: state.turns.map((t) => (t.id === event.turnId ? { ...t, final: event.final } : t)),
      };
    case "TurnFailed":
      return {
        ...state,
        turns: state.turns.map((t) => (t.id === event.turnId ? { ...t, error: event.error } : t)),
      };
  }
}

export function foldEvents(events: readonly DomainEvent[]): SessionState {
  return events.reduce(reduceEvent, initialState());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/core/test/session/state.test.ts --coverage.enabled --coverage.include='packages/core/src/session/state.ts'`
Expected: PASS (existing tests + 3 new); `state.ts` 100% (the `isPhaseEvent` branch, the `?? { ... }` seed branch — covered by the "no phase events" + the two folding tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/session/events.ts packages/core/src/session/state.ts packages/core/test/session/state.test.ts
git commit -m "feat(playbook): fold PhaseTransition events into SessionState"
```

---

### Task 4: The pure transition machine

**Files:**

- Create: `packages/core/src/playbook/machine.ts`
- Test: `packages/core/test/playbook/machine.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/playbook/machine.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { step, type GateVerdict } from "../../src/playbook/machine.js";
import { DEFAULT_MANIFEST } from "../../src/playbook/manifest.js";
import type { PlaybookRunState } from "../../src/playbook/events.js";

const passed: GateVerdict = { status: "passed" };
const failed: GateVerdict = { status: "failed", reason: "red" };
const needsOp: GateVerdict = { status: "needs-operator", reason: "confirm" };
const at = (phase: PlaybookRunState["phase"], replans = 0): PlaybookRunState => ({
  phase,
  replans,
});

describe("playbook machine — step", () => {
  it("a passed gate advances to the sequential next phase", () => {
    expect(step(DEFAULT_MANIFEST, at("Research"), passed)).toEqual({
      next: { phase: "Plan", replans: 0 },
      outcome: "advanced",
    });
    expect(step(DEFAULT_MANIFEST, at("Execute"), passed)).toEqual({
      next: { phase: "Validate", replans: 0 },
      outcome: "advanced",
    });
  });

  it("a passed Validate advances to the terminal Present phase", () => {
    expect(step(DEFAULT_MANIFEST, at("Validate"), passed)).toEqual({
      next: { phase: "Present", replans: 0 },
      outcome: "advanced",
    });
  });

  it("a failed Validate routes to onFail (Plan) and increments replans", () => {
    expect(step(DEFAULT_MANIFEST, at("Validate", 0), failed)).toEqual({
      next: { phase: "Plan", replans: 1 },
      outcome: "replan",
    });
  });

  it("exceeding maxReplans escalates instead of looping", () => {
    // maxReplans is 3; the 4th failure (replans 3 -> 4) escalates.
    expect(step(DEFAULT_MANIFEST, at("Validate", 3), failed)).toEqual({
      next: { phase: "Validate", replans: 4 },
      outcome: "escalated",
    });
  });

  it("a needs-operator verdict pauses without moving", () => {
    expect(step(DEFAULT_MANIFEST, at("Research"), needsOp)).toEqual({
      next: { phase: "Research", replans: 0 },
      outcome: "paused",
    });
  });

  it("any verdict at the terminal phase is a no-op", () => {
    expect(step(DEFAULT_MANIFEST, at("Present"), passed)).toEqual({
      next: { phase: "Present", replans: 0 },
      outcome: "noop",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/machine.test.ts`
Expected: FAIL — cannot find module `../../src/playbook/machine.js`.

- [ ] **Step 3: Write `packages/core/src/playbook/machine.ts`**

```ts
import { type PlaybookManifest, phaseSpec, nextPhase } from "./manifest.js";
import type { PlaybookRunState } from "./events.js";

/** A phase gate's verdict — the Eleven-style accept-or-correct decision for a phase.
 *  `needs-operator` is a soft phase pausing for a capability-gated override (P3). */
export type GateVerdict =
  | { status: "passed" }
  | { status: "failed"; reason: string }
  | { status: "needs-operator"; reason: string };

/** What `step` decided: the next run state and a label the runner turns into events. */
export interface Transition {
  next: PlaybookRunState;
  outcome: "advanced" | "replan" | "escalated" | "paused" | "noop";
}

/**
 * The pure transition function. Given the current run state and a gate verdict,
 * compute the next state and an outcome label. No IO — the runner (P3) performs the
 * event commits, audit, and capability checks around this.
 */
export function step(
  manifest: PlaybookManifest,
  state: PlaybookRunState,
  verdict: GateVerdict,
): Transition {
  if (nextPhase(manifest, state.phase) === undefined) {
    return { next: state, outcome: "noop" }; // terminal phase: nothing advances
  }
  switch (verdict.status) {
    case "passed": {
      const np = nextPhase(manifest, state.phase) as PlaybookRunState["phase"];
      return { next: { ...state, phase: np }, outcome: "advanced" };
    }
    case "failed": {
      const replans = state.replans + 1;
      if (replans > manifest.maxReplans) {
        return { next: { ...state, replans }, outcome: "escalated" };
      }
      const target = phaseSpec(manifest, state.phase).onFail ?? state.phase;
      return { next: { phase: target, replans }, outcome: "replan" };
    }
    case "needs-operator":
      return { next: state, outcome: "paused" };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/playbook/machine.test.ts --coverage.enabled --coverage.include='packages/core/src/playbook/machine.ts'`
Expected: PASS (6 tests); `machine.ts` 100%. (The `onFail ?? state.phase` fallback's right side is defensive for manifests whose `validate` phase lacks `onFail`; if v8 flags it uncovered, add the test below.)

> If coverage flags the `?? state.phase` branch, add this test to `machine.test.ts`:
>
> ```ts
> it("a failed gate with no onFail stays on the same phase", () => {
>   const m = {
>     phases: [
>       { phase: "Validate", gate: "validate" },
>       { phase: "Present", gate: "soft" },
>     ],
>     maxReplans: 3,
>   } as const;
>   expect(step(m, at("Validate", 0), failed)).toEqual({
>     next: { phase: "Validate", replans: 1 },
>     outcome: "replan",
>   });
> });
> ```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/playbook/machine.ts packages/core/test/playbook/machine.test.ts
git commit -m "feat(playbook): pure phase-transition machine (step)"
```

---

### Task 5: Barrel exports + the full gate

**Files:**

- Create: `packages/core/src/playbook/index.ts`
- Modify: `packages/core/src/index.ts` (re-export the playbook barrel)
- Test: `packages/core/test/playbook/index.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/playbook/index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as playbook from "../../src/playbook/index.js";

describe("@openhawkins/core playbook barrel", () => {
  it("re-exports the manifest, events, and machine surface", () => {
    expect(playbook.DEFAULT_MANIFEST.phases.length).toBe(6);
    expect(typeof playbook.nextPhase).toBe("function");
    expect(typeof playbook.isPhaseEvent).toBe("function");
    expect(typeof playbook.foldPlaybook).toBe("function");
    expect(typeof playbook.step).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/index.test.ts`
Expected: FAIL — cannot find module `../../src/playbook/index.js`.

- [ ] **Step 3: Write the barrels**

Create `packages/core/src/playbook/index.ts`:

```ts
export * from "./manifest.js";
export * from "./events.js";
export * from "./machine.js";
```

Then append to `packages/core/src/index.ts` (after the existing `export * from` lines):

```ts
export * from "./playbook/index.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/playbook/index.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Run the FULL gate**

Run: `npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional`
Expected: all green; coverage ≥99% across all metrics, with every `packages/core/src/playbook/*.ts` file at 100%. If `format:check` complains, run `npm run format` first. Paste the coverage table tail.

> Note: `index.ts` barrels are exercised by `index.test.ts`. If `playbook/index.ts` or the `SessionState.playbook` type-only surface is reported below 100% statements but the aggregate stays ≥99%, confirm the aggregate gate passes (exit 0) before proceeding — do not lower any threshold.

- [ ] **Step 6: Run the Docker gate (the required PR check)**

Run: `docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test`
Expected: ends with `✅ ALL GATES PASSED`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/playbook/index.ts packages/core/src/index.ts packages/core/test/playbook/index.test.ts
git commit -m "feat(playbook): barrel exports; P1 machine+events complete"
```

---

## Self-Review (coverage of the spec — P1 portion)

- **Spec §3.1 — components:** `manifest.ts` (Task 1), `events.ts` (Task 2), `machine.ts` (Task 4) are the three pure-core P1 files. `gates.ts` and `runner.ts` are **P2/P3** (not this plan). ✓
- **Spec §3.2 — phase machine (forward + Validate→Plan fail edge, terminal Present):** `step` covers advanced / replan / escalated / paused / noop; the default manifest's `Validate.onFail = Plan` drives the fail edge (Tasks 1, 4). ✓
- **Spec §3.3 — PhaseTransition events; current phase is a fold; reduceEvent extended; SessionState carries PlaybookRunState:** four `PhaseEvent` variants + `reducePlaybook`/`foldPlaybook` (Task 2); union + `SessionState.playbook` + delegation (Task 3). ✓
- **Spec §4 — replan budget (maxReplans default 3 → escalate):** `DEFAULT_MANIFEST.maxReplans = 3` (Task 1); `escalated` outcome when `replans > maxReplans` (Task 4). ✓
- **Spec §6 — testing (pure machine exhaustive; fold/replay; behavior-level; ≥99%):** every task is TDD with behavior assertions; full gate + Docker gate in Task 5. ✓
- **Deferred to later milestones (not this plan):** `GateContext`/`PhaseGate`/`SoftGate`/`ValidateGate` predicate (P2); `PlaybookRun` runner, Murray audit writes, the `playbook:override` capability + denied-override handling, operator-override flow, and the event-emission mapping from `Transition.outcome` (P3). The `GateVerdict` type ships in P1 (Task 4) because `step` consumes it; the gates that produce it are P2.
- **Type consistency:** `Phase`, `PhaseSpec`, `PlaybookManifest`, `DEFAULT_MANIFEST`, `phaseSpec`, `nextPhase`, `PhaseEvent`, `PlaybookRunState`, `isPhaseEvent`, `reducePlaybook`, `foldPlaybook`, `GateVerdict`, `Transition`, `step` — names used identically across Tasks 1–5 and the tests. ✓

---

## Next plans (after P1 lands)

- **P2** — `gates.ts`: the `PhaseGate` interface + `GateContext`; `SoftGate` (always `needs-operator`); `ValidateGate` over an injected `() => Promise<{ ok; detail? }>` predicate, plus the real repo-gate-command predicate.
- **P3** — `runner.ts`: `PlaybookRun` single-writer driver mapping `Transition.outcome` → emitted `PhaseEvent`s + Murray audit; the `playbook:override` capability (added to `CapabilityName`) with denied-override auditing; the replan-budget/escalation flow; full event-sequence + audit-chain tests.
