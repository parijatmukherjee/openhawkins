# Playbook — Runtime-Enforced Agent Process — Design (stub)

**Date:** 2026-06-09
**Status:** Draft stub (not yet scheduled; design to be expanded before planning)
**Parent:** [`2026-06-05-openhawkins-design.md`](./2026-06-05-openhawkins-design.md) (umbrella)
**Decision:** [ADR 0002 — Runtime-enforced agent process, not n8n](../adr/0002-process-enforcement-native-not-n8n.md)
**Targeted subproject:** ~S3 (with the Nexus / Pulse), or a thin `core` layer earlier

> A runtime-owned state machine that forces every agent run through a fixed process —
> **Research → Plan → Tasks → Execute → Validate/Test → Present**, with a fail→replan
> loop — via **code-enforced transitions**. The process becomes an enforced invariant,
> the way **Eleven** makes grounding one. The model proposes "I'm done with this
> phase"; the runtime decides. Not n8n (ADR 0002).

---

## 1. Goal & non-goals

**Goal.** Make the working process un-skippable: an agent cannot reach `Present`
without a passing `Validate`, and a failed `Validate` _forces_ a return to `Plan`.
Phase transitions are recorded as events (replayable, audited), so a run's adherence
to the process is verifiable after the fact.

**Non-goals (for this stub).** The full implementation; the orchestrator's 5-phase
Pulse (separate, S3 — though the Playbook may compose with it); n8n integration
(an edge plugin, ADR 0002).

---

## 2. The phase machine

```
Research ──▶ Plan ──▶ Tasks ──▶ Execute ──▶ Validate ──▶ Present (terminal)
                ▲                               │
                └──────────── fail ◀────────────┘
```

- **States:** `Research`, `Plan`, `Tasks`, `Execute`, `Validate`, `Present`.
- **Transitions are code-enforced.** Forward transitions require the current phase's
  acceptance gate to pass (§3). `Validate` has two edges: pass → `Present`; fail →
  `Plan`. No edge lets the model jump straight to `Present`.
- **Terminal:** `Present`. The run ends with a presented artifact (e.g. a PR/summary)
  and a human decision point.

---

## 3. Acceptance gates (Eleven-style)

Each phase defines an `accepted(state) → boolean | correction`, exactly like Eleven's
accept-or-reprompt. Initial sketch (to be refined):

| Phase    | Accepted when…                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------- |
| Research | the relevant context/spikes are recorded (a research note artifact exists).                               |
| Plan     | a design/implementation plan artifact exists and is approved.                                             |
| Tasks    | the plan is decomposed into discrete, tracked tasks.                                                      |
| Execute  | every task reports complete (and committed).                                                              |
| Validate | the gate is green — build · lint · format:check · coverage (≥99%) · test · test:functional · docker-gate. |
| Present  | a PR/summary is produced; control returns to the human.                                                   |

The runtime owns each predicate; the model cannot self-certify a phase complete.

---

## 4. Reuse of existing primitives

- **Agent loop / Eleven accept-policy** — the per-phase gate is the same accept-or-
  correct mechanism Eleven already uses for grounding.
- **VINES (event-sourced session)** — each phase transition is a `DomainEvent`;
  process state is a fold over the log → deterministic replay.
- **Murray (audit)** — transitions are hash-chained; "did this run skip the plan?"
  is answerable and tamper-evident.
- **The Lab (capabilities)** — phase actions are capability-gated; an operator
  override to skip a phase is itself an audited, capability-gated action.

---

## 5. Open questions

- **Where it lives:** a thin `core` layer over the agent loop, vs. the orchestrator
  (`S3`, alongside the Pulse). How do a Playbook and the Pulse compose?
- **How Playbooks are declared:** config? a skill/manifest? per-agent vs per-task?
- **Per-phase gate definitions:** exact, checkable predicates (esp. `Research` and
  `Plan`, which are softer than `Validate`).
- **Escape hatches:** operator force-skip / abort, recorded with provenance and
  audit (so enforcement is strict but not a hard lock-in).
- **Granularity:** does the loop run per agent _run_, per _task_, or both (nested)?
- **Failure budget:** max replan cycles before escalating to a human.

---

## 6. Next steps

Expand this stub into a full design (Research → Plan per `CLAUDE.md`) when the
orchestrator (S3) is being scoped, then write an implementation plan. No code until
the design is approved.
