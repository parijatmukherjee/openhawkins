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

export function foldEvents(events: readonly DomainEvent[], state = initialState()): SessionState {
  return events.reduce(reduceEvent, state);
}
