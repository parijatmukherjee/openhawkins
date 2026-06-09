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
  const successor = nextPhase(manifest, state.phase);
  if (successor === undefined) {
    return { next: state, outcome: "noop" }; // terminal phase: nothing advances
  }
  switch (verdict.status) {
    case "passed":
      return { next: { ...state, phase: successor }, outcome: "advanced" };
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
