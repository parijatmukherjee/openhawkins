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
