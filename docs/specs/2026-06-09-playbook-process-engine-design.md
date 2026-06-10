# Playbook — Runtime-Enforced Agent Process — Design

**Date:** 2026-06-09
**Status:** Draft for review
**Parent:** [`2026-06-05-openhawkins-design.md`](./2026-06-05-openhawkins-design.md) (umbrella)
**Decision:** [ADR 0002 — Runtime-enforced agent process, not n8n](../adr/0002-process-enforcement-native-not-n8n.md)
**Targeted subproject:** a thin `core` layer (ships before S3; the S3 orchestrator drives it later)

> A runtime-owned state machine that forces every agent run through a fixed process —
> **Research → Plan → Tasks → Execute → Validate → Present**, with a fail→replan loop —
> via **code-enforced transitions**. The process becomes an enforced invariant, the way
> **Eleven** makes grounding one. The model proposes "I'm done with this phase"; the
> runtime decides. Not n8n (ADR 0002).

---

## 1. Goal & non-goals

**Goal.** Make the working process un-skippable: an agent cannot reach `Present`
without a passing `Validate`, and a failed `Validate` _forces_ a return to `Plan`.
Every phase transition is recorded as a domain event (replayable, audited), so a run's
adherence to the process is verifiable and tamper-evident after the fact. Soft phases
(whose completion can't be machine-checked) are not waved through on the model's
say-so — they pause for a capability-gated, audited operator decision.

**Non-goals (this increment).**

- The S3 orchestrator's 5-phase Pulse and multi-agent coordination (separate; the
  Playbook is designed to compose with it but does not depend on it).
- A nested per-_task_ loop inside `Execute` — this increment governs **one agent run**
  (§3.5 leaves a clean seam for nesting later).
- An authoring UI or alternate-manifest marketplace. One built-in manifest ships; the
  manifest is data, so more can be added later without redesign.
- n8n integration (an edge plugin, ADR 0002), and any change to the existing CI/Docker
  gate (the Playbook _calls_ a gate predicate; it does not replace CI).

---

## 2. Decisions locked (from brainstorming)

| Question                  | Decision                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| Where it lives            | A thin layer in `packages/core` now; the S3 orchestrator drives it later                 |
| Granularity               | Per agent **run** (nestable per-task later, §3.5)                                        |
| Enforcement of soft gates | **Hard** transitions; soft gates pause for a capability-gated, audited operator override |
| Phase-state model         | New **PhaseTransition domain events** in VINES; current phase is a fold                  |
| Phase/gate declaration    | A **declarative manifest** (data) the runtime interprets; one built-in default           |
| Validate gate             | A **pluggable async predicate**; default runs the repo gate command                      |

---

## 3. Architecture

A new module `packages/core/src/playbook/`. It owns exactly two things: **which phase a
run is in**, and **whether a proposed transition is allowed**. It owns no model or tool
work — that stays in the agent loop (`loop/agent-loop.ts`). It composes the four
existing primitives rather than duplicating them:

- **VINES** (`session/events.ts`, `session/state.ts`) — phase changes are new
  `DomainEvent` variants appended to the same `EventStore` and folded into
  `SessionState`. Replay and crash-recovery come for free.
- **Eleven's accept-policy shape** (`loop/turn.ts` `AcceptPolicy`) — a phase gate
  mirrors `evaluate(ctx) → accept | { accept:false, correction }`. The model proposes
  "phase complete"; the runtime owns the decision.
- **The Lab** (`security/capability.ts` `grantSatisfies`) — a phase override is a
  capability-gated action (default-deny).
- **Murray** (`security/audit.ts` `AuditLog`) — every transition and override is a
  hash-chained audit entry.

### 3.1 Components

Each file has one responsibility and a small, testable surface.

| File                   | Responsibility                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `playbook/manifest.ts` | `PlaybookManifest` type (ordered phases; each phase names its gate kind + `onFail` target + soft/hard flag) and the built-in **default manifest** (the AGENT.md spine). |
| `playbook/events.ts`   | The new `PhaseEvent` `DomainEvent` variants (§3.3) and their reducer contribution.                                                                                      |
| `playbook/machine.ts`  | `PlaybookMachine` — a **pure** function from (current phase, gate verdict) to the next phase + the event(s) to emit. No IO. Drives both forward and fail→replan edges.  |
| `playbook/gates.ts`    | The `PhaseGate` interface and concrete gates: `ValidateGate` (calls an injected predicate; default = run the repo gate), and `SoftGate` (returns `needs-operator`).     |
| `playbook/runner.ts`   | `PlaybookRun` — the single-writer driver: calls gates, asks the machine, commits events, writes audit, enforces the override capability and the replan budget.          |

### 3.2 The phase machine

```
Research ──▶ Plan ──▶ Tasks ──▶ Execute ──▶ Validate ──▶ Present (terminal)
                ▲                               │
                └──────────── fail ◀────────────┘
```

- **States** come from the manifest: `Research`, `Plan`, `Tasks`, `Execute`,
  `Validate`, `Present`.
- **Forward transitions** require the current phase's gate verdict to be `passed`.
- **`Validate` has two edges:** `passed` → `Present`; `failed` → the manifest's
  `onFail` (= `Plan`). No edge lets the model jump straight to `Present`.
- **Terminal:** `Present`. The run ends with a presented artifact (a PR/summary) and a
  human decision point.

The pure transition function `step(manifest, state, verdict)` (in `machine.ts`) is
exhaustively testable; the runner performs the IO around it.

### 3.3 State model — PhaseTransition events (VINES)

Current phase is **never** held only in memory — it is a fold over the event log, so a
crash mid-run restores the exact phase on restart (each transition is a single
committed event; none is half-applied). New `DomainEvent` variants, added to the
existing union in `session/events.ts`:

```ts
| { type: "PhaseEntered";    sessionId: string; runId: string; phase: Phase; at: number }
| { type: "PhaseGatePassed"; sessionId: string; runId: string; phase: Phase; at: number }
| { type: "PhaseGateFailed"; sessionId: string; runId: string; phase: Phase; reason: string; escalate: boolean; at: number }
| { type: "PhaseOverridden"; sessionId: string; runId: string; phase: Phase; actor: string; reason: string; at: number }
```

`reduceEvent` is extended so `SessionState` carries the current `PlaybookRunState`
(current phase + replan count). The reducer stays a pure fold; the existing turn-state
handling is untouched. (Whether a run is _paused_ awaiting an operator is derivable from
the log — being in a soft phase with no following `PhaseOverridden`, or a `Validate`
`PhaseGateFailed{escalate:true}` — so it is not stored as a field; the P3 runner adds
that derivation rather than a persisted flag.)

### 3.4 Gates (the Eleven-style accept policy)

```ts
type GateVerdict =
  | { status: "passed" }
  | { status: "failed"; reason: string }
  | { status: "needs-operator"; reason: string }; // soft phase: pause for override

interface PhaseGate {
  evaluate(ctx: GateContext): Promise<GateVerdict>;
}
```

Initial gate assignment in the default manifest:

| Phase    | Gate           | Passes when…                                                                                                                        |
| -------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Research | `SoftGate`     | `needs-operator` — an operator confirms the research note/spikes exist.                                                             |
| Plan     | `SoftGate`     | `needs-operator` — an operator confirms an approved plan artifact exists.                                                           |
| Tasks    | `SoftGate`     | `needs-operator` — an operator confirms the plan is decomposed into tracked tasks.                                                  |
| Execute  | `SoftGate`     | `needs-operator` — an operator confirms every task is complete and committed.                                                       |
| Validate | `ValidateGate` | the injected predicate returns green (default: build · lint · format:check · coverage ≥99% · test · test:functional · docker-gate). |
| Present  | —              | terminal; entering it _is_ the outcome.                                                                                             |

The `ValidateGate` takes an injected `() => Promise<{ ok: boolean; detail?: string }>`
predicate so it is unit-testable with a fake and real by default. A predicate that
**throws** is caught and treated as `failed` (never crashes the runner).

> **Why soft gates pause rather than self-attest.** The whole thesis is "the model
> proposes, the runtime enforces." Letting the model self-certify `Research` done would
> reintroduce exactly the discretion the Playbook removes. `needs-operator` keeps the
> guarantee while staying escapable — but only with provenance (§3.6). As objective,
> checkable predicates for the soft phases emerge (e.g. "a plan artifact exists at
> path X"), individual `SoftGate`s can be swapped for real predicate gates with no
> machine or event-model change.

### 3.5 Granularity & the nesting seam

This increment runs the machine once per **agent run**, keyed by a `runId`. The events
carry `runId` (not just `sessionId`) precisely so a future nested per-task loop can run
its own machine instances under the `Execute` phase without changing the event model or
the reducer. Nesting is explicitly out of scope here (§1) but designed-for.

### 3.6 Overrides — capability-gated, audited (The Lab + Murray)

A `needs-operator` verdict **pauses** the run. Advancing requires an operator action
that carries a capability satisfying `grantSatisfies(grant, { name: "playbook:override" })`
(a new `CapabilityName`, default-deny like every other). On success the runner commits
`PhaseOverridden{ phase, actor, reason }` and the machine advances as if the gate
passed. An override **attempt without the capability is denied and audited** as a denied
attempt — the enforcement is strict but escapable only with recorded provenance.

### 3.7 Data flow (one forward step)

1. The driver of an agent run signals "phase complete" to `PlaybookRun`.
2. `runner` calls the current phase's `gate.evaluate(ctx)`.
3. **`passed`** → commit `PhaseGatePassed` + `PhaseEntered(next)`; `audit.append` both.
4. **`failed`** → commit `PhaseGateFailed{reason, escalate}`; the machine routes to
   `onFail`; audit. (`Validate` red lands here → back to `Plan`.)
5. **`needs-operator`** → set `paused`; wait for an operator override (§3.6). On a
   capability-bearing override, commit `PhaseOverridden` and advance; otherwise stay
   paused.

The current phase after every step equals `fold(events)`.

---

## 4. Error handling & edge cases

- **Gate predicate throws** → caught, treated as `failed` with the error as `reason`;
  the runner never throws out (Eleven/registry never-throw discipline).
- **Replan budget.** The manifest carries `maxReplans` (default **3**). A `Validate`
  failure increments a counter; exceeding the budget commits
  `PhaseGateFailed{ escalate: true }` and pauses for an operator instead of looping to
  `Plan` again — no infinite `Validate → Plan` cycle.
- **Override without capability** → denied; audited as a denied attempt (default-deny).
- **Crash mid-run** → restart folds the event log and resumes at the exact phase and
  replan count; no transition is half-applied.
- **Unknown/duplicate signal** (e.g. "complete" for a phase that already advanced) →
  the machine is a function of the _folded_ current phase, so a stale signal is a no-op
  rather than a double transition. The single-writer runner serializes steps (like
  `Session.runTurn`).

---

## 5. Reuse of existing primitives (no parallels invented)

- **Agent loop / Eleven accept-policy** — the per-phase gate is the same
  accept-or-correct mechanism Eleven already uses for grounding (`AcceptPolicy`).
- **VINES (event-sourced session)** — each transition is a `DomainEvent`; process state
  is a fold over the log → deterministic replay.
- **Murray (audit)** — transitions are hash-chained; "did this run skip the plan?" is
  answerable and tamper-evident (`verify()`).
- **The Lab (capabilities)** — overrides are capability-gated, audited actions.

---

## 6. Testing strategy

- **`machine.ts`** — pure; exhaustive transition tests: every forward edge, the
  `Validate → Plan` fail edge, the replan-budget-exhausted escalation, and stale-signal
  no-ops.
- **`gates.ts`** — `ValidateGate` with a **fake predicate** for pass/fail/throw; one
  integration test wires the real repo-gate-command predicate.
- **`runner.ts`** — assert the **emitted event sequence** and the **audit chain**
  (`verify() === true`) for: a clean run Research→…→Present; a run with one `Validate`
  failure → replan → pass; an operator override of a soft gate; a denied override
  (no capability); and a budget-exhausted escalation.
- Coverage ≥99% across all metrics, behavior-level (assert events/verdicts, not lines),
  Node + Bun, per the gate.

---

## 7. Open questions (deferred, not blocking this increment)

- **Composition with the S3 Pulse:** how a per-run Playbook nests under (or alongside)
  the orchestrator's 5-phase Pulse when S3 lands.
- **Objective soft-gate predicates:** replacing `SoftGate`s for `Research`/`Plan`/
  `Tasks`/`Execute` with checkable predicates (artifact-exists, tasks-tracked) as those
  signals become available — a gate swap, no model/event change.
- **Per-task nesting** (§3.5): when and how the nested loop under `Execute` is enabled.
- **Operator surface:** how an operator delivers an override in practice (CLI flag,
  API, channel command) — an integration concern for the consumer that first drives a
  Playbook.

---

## 8. Milestones (for the implementation plan)

- **P1 — Machine + events (pure core).** `Phase`/`PlaybookManifest`/default manifest;
  the `PhaseEvent` variants + reducer extension; the pure `step` machine. Fully unit-
  tested, no IO.
- **P2 — Gates.** `PhaseGate` interface; `SoftGate`; `ValidateGate` over an injected
  predicate + the real repo-gate-command predicate.
- **P3 — Runner.** `PlaybookRun` single-writer driver: commit events, write Murray
  audit, enforce the `playbook:override` capability and the replan budget; the full
  event-sequence + audit-chain tests.

Each milestone is independently reviewable and lands behind the same gate. No code
until this design is approved.
