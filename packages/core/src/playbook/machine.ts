import { type PlaybookManifest, type Phase, phaseSpec, nextPhase } from "./manifest.js";
import type { PlaybookRunState } from "./events.js";

/** A phase gate's verdict — the Eleven-style accept-or-correct decision for a phase.
 *  `needs-operator` is a soft phase pausing for a capability-gated override (P3). */
export type GateVerdict =
  | { status: "passed" }
  | { status: "failed"; reason: string }
  | { status: "needs-operator"; reason: string };

/** What `step` decided: the phase to enter next and an outcome label. Deliberately does NOT
 *  carry a `replans` count — that lives in exactly one place, the `reducePlaybook` fold over
 *  `PhaseGateFailed` events, so the runtime count and the replayed count cannot drift
 *  (review F-H2). The runner performs the event commits, audit, and capability checks. */
export interface Transition {
  phase: Phase;
  outcome: "advanced" | "replan" | "escalated" | "paused" | "noop";
}

/**
 * The pure transition function. Given the current run state and a gate verdict, compute the
 * phase to enter next and an outcome label. No IO, and no counting: the escalate-vs-replan
 * decision reads the canonical, event-folded `state.replans` rather than maintaining its own.
 */
export function step(
  manifest: PlaybookManifest,
  state: PlaybookRunState,
  verdict: GateVerdict,
): Transition {
  const successor = nextPhase(manifest, state.phase);
  if (successor === undefined) {
    return { phase: state.phase, outcome: "noop" }; // terminal phase: nothing advances
  }
  switch (verdict.status) {
    case "passed":
      return { phase: successor, outcome: "advanced" };
    case "failed": {
      // Escalate once the replan budget is spent. `state.replans` is the canonical count
      // folded from the log; `>= maxReplans` is exactly the old `state.replans + 1 >
      // maxReplans` — the +1 now happens only in `reducePlaybook` when the runner commits
      // the `PhaseGateFailed` event this failure produces.
      if (state.replans >= manifest.maxReplans) {
        return { phase: state.phase, outcome: "escalated" };
      }
      const target = phaseSpec(manifest, state.phase).onFail ?? state.phase;
      return { phase: target, outcome: "replan" };
    }
    case "needs-operator":
      return { phase: state.phase, outcome: "paused" };
  }
}
