# ADR 0002 — Runtime-enforced agent process (Playbooks), not n8n

**Status:** Accepted (2026-06-09)

**Context:** We want every agent run to follow a fixed working process —
**Research → Plan → Tasks → Execute → Validate/Test → Present**, with a failed
Validate looping back to Plan — and we want that process to be _enforced_, not left
to the model's discretion. The question raised: should we embed **n8n** as the
engine that drives the agent through these stages?

**Decision:** Enforce the process **natively** in the runtime as a first-class
"Playbook" / process state machine — the same way **Eleven** enforces grounding.
Do **not** use n8n (or any external workflow engine) as the agent's control plane.

**Why native, not n8n:**

- **It is the core thesis.** OpenHawkins exists to make the runtime enforce what the
  model leaves to discretion (tool-calling, grounding, state transitions). The
  working process is just another runtime-enforced invariant. Outsourcing it to n8n
  inverts the thesis and rebuilds the Nexus in a low-code tool.
- **Determinism / replay / audit.** Process state must live in the event-sourced
  session (**VINES**) and the hash-chained audit (**Murray**) so runs replay
  deterministically and "why did it skip the plan?" is forensically answerable. n8n
  would hold that state in its own engine/DB, outside replay and audit.
- **Self-contained.** A separate n8n service (+ DB + UI) in the hot path of every
  turn contradicts the embedded-SQLite, single self-contained binary,
  no-external-service goals (ADR 0001).
- **Reuses what exists.** The phase machine layers directly on the agent loop, the
  Eleven accept-or-reprompt pattern, VINES state, the capability gate (**The Lab**),
  and Murray audit — small, on-thesis surface area.

n8n _could_ technically branch on validate-pass/fail and loop, but making it the
control plane sacrifices exactly the properties OpenHawkins is built to guarantee.

**Shape of the native solution** (see the design stub
[`docs/specs/2026-06-09-playbook-process-engine-design.md`](../specs/2026-06-09-playbook-process-engine-design.md)):

- Phases are states; transitions are **code-enforced** (cannot reach Present without
  a passing Validate; a failed Validate forces a return to Plan).
- Each phase has an **acceptance gate** (the model proposes "done"; the runtime
  decides), mirroring Eleven's grounding modes.
- Every transition is a `DomainEvent` → replayable + audited; capability-gated;
  single-writer.

**Where n8n still fits:** as an **edge integration plugin** — a webhook-trigger
channel plus a capability-gated outbound tool — so operators interoperate with their
existing n8n workflows. That is orthogonal to enforcing the agent's _own_ process and
lands with the plugin SDK (S4–S7), not the core.

**Consequences:** A new component — the Playbook / process engine — enters the build
order (targeted around the orchestrator, S3, or a thin core layer earlier). Until it
ships, the process is followed as documented practice (`CLAUDE.md`), with the
Validate/Test phase already machine-enforced by the CI gate (build + lint + format +
coverage ≥99% + the required `docker-gate`).
