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

/** Keyed by every `PhaseEvent` type. Being a `Record<PhaseEvent["type"], true>`, the
 *  compiler requires an entry for each union member — so adding a fifth PhaseEvent
 *  variant is a type error here until it is listed, keeping the guard in sync with the
 *  union (this guard is the seam that routes phase events out of `DomainEvent`). */
const PHASE_EVENT_TYPES: Record<PhaseEvent["type"], true> = {
  PhaseEntered: true,
  PhaseGatePassed: true,
  PhaseGateFailed: true,
  PhaseOverridden: true,
};

/** True when `e` is one of the four PhaseTransition events. */
export function isPhaseEvent(e: { type: string }): e is PhaseEvent {
  return Object.hasOwn(PHASE_EVENT_TYPES, e.type);
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
  const first = events[0];
  if (first === undefined) {
    throw new Error("foldPlaybook: empty event log");
  }
  const seed: PlaybookRunState = { phase: first.phase, replans: 0 };
  return events.reduce(reducePlaybook, seed);
}
