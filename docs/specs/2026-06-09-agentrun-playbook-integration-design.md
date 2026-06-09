# AgentRun — wiring the Playbook into a real agent run — Design

**Date:** 2026-06-09
**Status:** Draft for review
**Parent:** [`2026-06-05-openhawkins-design.md`](./2026-06-05-openhawkins-design.md) (umbrella)
**Builds on:** [`2026-06-09-playbook-process-engine-design.md`](./2026-06-09-playbook-process-engine-design.md) (the Playbook engine — P1 core + P2 gates + P3 runner, all merged)

> The Playbook engine (`PlaybookRun`) is a process state machine — it gates transitions
> but does no work. `AgentRun` is the thin orchestrator that drives a real agent run
> _through_ that machine: it runs each phase's work, advances the runtime-enforced gate,
> and — when a soft phase pauses — consults a human/operator to override or halt. This is
> the integration the Playbook spec deferred (§7): making an actual agent run a
> Research→Plan→Tasks→Execute→Validate→Present process the runtime enforces.

---

## 1. Goal & non-goals

**Goal.** Turn "an agent run" from a single `Agent.ask()` turn into a **Playbook-governed
process**: a small orchestrator sequences caller-supplied per-phase work, advances the
`PlaybookRun` after each phase (so the gate decides, not the model), pauses for a
capability-gated operator on soft phases, and runs the **real repo gate** at Validate —
producing one replayable, audited trace per run.

**Non-goals (this increment).**

- A fully autonomous phase-deciding agent (the model choosing each phase's work) — that
  is the S3 orchestrator, far larger than this wiring.
- Changing the `Agent`/`PlaybookRun`/gates themselves — they are reused unchanged.
- A persistent/resumable run driver across process restarts (the event log already makes
  a run replayable; an explicit resume API is a later increment).
- A rich operator UI. One human/stdin operator (for the CLI) and a fake (for tests) ship;
  richer surfaces (API, channel) are later.

---

## 2. Decisions locked (from brainstorming)

| Question          | Decision                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape             | A **new `AgentRun` orchestrator** owning the sequencing; `Agent`/`PlaybookRun` stay independent                                                                   |
| Per-phase work    | **Caller-supplied `PhaseHandler`s** (each closes over an `Agent` and does that phase's work)                                                                      |
| Soft-gate advance | A **human/operator callback** (`Operator`) consulted on each pause — approve (override) or halt                                                                   |
| Validate gate     | The **real repo gate** in production (`gateCommandPredicate(DEFAULT_GATE_COMMANDS)`); injected via the `PlaybookRun`, so tests use a fake (no recursive gate run) |

> **Why Validate is injected, not hard-wired.** "Validate = always the real repo gate"
> is the _production_ behavior. If `AgentRun`'s own unit tests literally spawned the gate,
> `npm run coverage` would re-run the whole suite — infinitely. `PlaybookRun` already
> takes `validateGate` as a dependency (P3), so the production factory wires the real
> gate and tests wire a fake; `AgentRun` itself is gate-agnostic.

---

## 3. Architecture

A new file `packages/core/src/playbook/agent-run.ts`. `AgentRun` owns exactly one thing:
**sequencing** a run through the phases. It does no model/tool work (that is the
caller's `PhaseHandler`s) and contains no gate logic (that lives in the `PlaybookRun` it
is given). So `Agent`, `PlaybookRun`, and `AgentRun` remain three independently testable
units, composed at the edges (the CLI / a test) rather than entangled.

### 3.1 Types

```ts
import type { Phase } from "./manifest.js";
import type { PlaybookRun } from "./runner.js";

/** Work for one phase — caller-supplied; typically closes over an Agent and calls
 *  `agent.ask(...)`. A phase with no handler (e.g. Validate, whose "work" is the gate)
 *  is a no-op. */
export type PhaseHandler = (ctx: { phase: Phase }) => Promise<void>;

/** An operator's decision when a soft phase pauses. */
export type OperatorDecision =
  | { approve: true; actor: string; reason: string }
  | { approve: false };

/** Consulted whenever a soft phase pauses (`needs-operator`). The runtime still owns the
 *  transition — this only supplies the capability-gated, audited override decision. */
export interface Operator {
  review(req: { phase: Phase; reason: string }): Promise<OperatorDecision>;
}

/** Why a run stopped. */
export type AgentRunResult =
  | { kind: "completed" } // reached the terminal Present phase
  | { kind: "halted-by-operator"; phase: Phase } // operator declined a soft phase
  | { kind: "escalated"; phase: Phase; reason: string }; // Validate replan budget exhausted

export interface AgentRunDeps {
  playbook: PlaybookRun;
  /** Work per phase; a missing entry is a no-op. */
  handlers: Partial<Record<Phase, PhaseHandler>>;
  operator: Operator;
}
```

### 3.2 The run loop

`AgentRun.run()` drives the process to a terminal `AgentRunResult`:

```
loop:
  status = playbook.status()
  if status.kind === "done":      return { kind: "completed" }
  if status.kind === "escalated": return { kind: "escalated", phase, reason }

  phase = playbook.state.phase
  await (handlers[phase]?.({ phase }))      // do the phase's work (no-op if none)
  status = await playbook.advance()         // the runtime evaluates the phase's gate

  if status.kind === "awaiting-operator":   // a soft phase paused
    const decision = await operator.review({ phase, reason: status.reason })
    if (!decision.approve) return { kind: "halted-by-operator", phase }
    status = await playbook.override(decision.actor, decision.reason)
    // a granted override advances; if it did NOT (the grant lacks the capability, so
    // `override` denied + audited it), the phase is unchanged — halt rather than re-loop
    if (status.kind === "awaiting-operator") return { kind: "halted-by-operator", phase }
  // status is now running / escalated / done → top of loop re-reads it
```

- Soft phases (`Research`/`Plan`/`Tasks`/`Execute`) → `advance` returns
  `awaiting-operator` → the `Operator` decides → `override` (audited `PhaseOverridden`)
  or halt.
- `Validate` → `advance` runs the real `ValidateGate`: `passed` → `Present` (→
  `completed`); `failed` → `Plan` (the loop re-runs the Plan→… handlers); budget
  exhausted → `escalated`.
- The terminal `Present` is observed at the top of the loop → `completed`.

Every transition the loop triggers is already a committed `PhaseEvent` + Murray audit
entry inside `PlaybookRun`; `AgentRun` adds no events of its own. A full run is therefore
replayable and tamper-evident, and `foldPlaybook(events)` reconstructs the final phase.

### 3.3 The operators

- **`HumanOperator`** (for the CLI) — prints the paused phase + reason and reads a
  decision from stdin (approve → actor from `$USER`/a flag + a typed reason; anything
  else → decline). Lives behind the same interface so the loop is unaware.
- **A fake operator** (tests) — returns a scripted sequence of decisions.

### 3.4 Production wiring (the CLI)

A thin entry (e.g. `openhawkins run`, `packages/core/src/bin/run.ts`, exercised by the
functional suite) builds the production `AgentRun`:

- a `PlaybookRun` over `DEFAULT_MANIFEST` with `softGate: new SoftGate()`,
  `validateGate: new ValidateGate(gateCommandPredicate(DEFAULT_GATE_COMMANDS))` (**the
  real repo gate**), a real `EventStore`/`AuditLog`, and a grant carrying
  `playbook:override`;
- per-phase handlers that call an `Agent.ask(...)` with a phase-appropriate prompt;
- a `HumanOperator`.

The CLI surface is intentionally minimal here; its job is to prove an end-to-end real run
exists. (Whether the CLI ships in this increment or the next is a planning decision — the
orchestrator + operators + tests are the core.)

---

## 4. Error handling & edge cases

- **A `PhaseHandler` throws** → `run()` does **not** swallow it; the exception propagates
  and the run stops. Rationale: a handler throwing means the phase's _work_ genuinely
  failed (a tool/model error), which is different from a _gate_ failure (data). The
  committed log still reflects the last entered phase, so the run is resumable later.
- **Validate predicate throws** → already contained by `ValidateGate` as a `failed`
  verdict (never-throws, P2) → routes to replan, never crashes `run()`.
- **Escalation** and **operator-decline** → returned as structured `AgentRunResult`s, not
  thrown.
- **A run already at `Present`** → `run()` returns `completed` immediately (the top-of-loop
  `done` check), committing nothing.
- **Operator approves but lacks the capability** → `playbook.override` already denies it
  (audited `PhaseOverrideDenied`) and returns the unchanged `awaiting-operator` status; the
  loop would re-consult the operator. To avoid a tight loop, `run()` treats an override
  that does not advance the phase as a halt (`halted-by-operator`) — the operator's grant
  is misconfigured, which is an operator problem, recorded in the audit.

---

## 5. Reuse of existing primitives (no parallels invented)

- **`PlaybookRun`** (P3) — owns the gate evaluation, event commits, Murray audit, and the
  capability-gated override. `AgentRun` only calls its `state`/`status`/`advance`/`override`.
- **`SoftGate`/`ValidateGate` + `gateCommandPredicate`** (P2) — the gates; the real one
  wired in production.
- **`Agent`** (S1) — used _inside_ handlers by the caller; `AgentRun` does not depend on
  it directly, keeping the orchestrator agent-agnostic and the dependency direction clean.
- **VINES / Murray / The Lab** — reached only through `PlaybookRun`.

---

## 6. Testing strategy

- **`AgentRun.run()`** with a real `PlaybookRun` (over `InMemoryEventStore` +
  `InMemoryAuditLog` + fake gates) + fake handlers + a fake operator — assert the
  **emitted event sequence + audit chain** (`verify() === true`) for:
  - a clean run: handlers run in phase order, the operator approves each soft phase,
    Validate passes → `completed` (event log is the full Research→…→Present trace);
  - a **replan**: Validate fails once → routes to Plan → the Plan→Execute handlers re-run
    → Validate passes → `completed`;
  - an **escalation**: `maxReplans` exhausted → `escalated`;
  - an **operator-decline**: the operator declines a soft phase → `halted-by-operator`,
    no further events;
  - a **handler throw**: `run()` rejects, the log stops at the last entered phase;
  - a **misconfigured override** (operator approves but the grant lacks the capability) →
    `halted-by-operator`, with a `PhaseOverrideDenied` audit entry.
- **One integration test** wiring a real `Agent` (scripted adapter) as a phase handler —
  proving an `agent.ask` runs inside a phase and its turn is recorded.
- Coverage ≥99% across all metrics, behavior-level (assert events/results, not lines),
  Node + Bun, per the gate.

---

## 7. Open questions (deferred, not blocking)

- **Resume across restarts:** an explicit API to rebuild an `AgentRun` from a persisted
  event log and continue (the log already supports it; the driver does not yet).
- **Richer operator surfaces:** API/channel operators beyond the CLI's stdin one.
- **Per-task nesting:** running a nested Playbook under `Execute` (the Playbook spec's
  §3.5 seam) once tasks are first-class.
- **Auto-advance policy:** an alternative `Operator` that auto-approves soft phases (still
  audited) for unattended runs — explicitly out of scope now (human operator chosen), but
  the `Operator` interface already admits it.

---

## 8. Milestones (for the implementation plan)

- **A1 — `AgentRun` + operators (core).** The types (§3.1), the `run()` loop (§3.2), a
  fake operator for tests, and the full event/audit-sequence test matrix (§6). No CLI, no
  real gate — pure orchestration over an injected `PlaybookRun`.
- **A2 — Production wiring.** `HumanOperator` (stdin), the production factory that builds
  an `AgentRun` with the real repo-gate `ValidateGate` + `Agent`-backed handlers, the
  `openhawkins run` CLI entry, and a black-box functional test of an end-to-end run on the
  scripted adapter.

Each milestone is independently reviewable and lands behind the same gate. No code until
this design is approved.
