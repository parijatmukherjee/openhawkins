import type { EventStore } from "./events.js";
import { foldEvents, type SessionState } from "./state.js";

/** Rebuild session state purely from the recorded event log. */
export async function rebuildState(store: EventStore, sessionId: string): Promise<SessionState> {
  const events = await store.read(sessionId);
  return foldEvents(events);
}

/**
 * Determinism guarantee: folding the same recorded log twice yields deeply equal
 * state. This is the primitive the agent loop's output-replay (S1.4/S1.5) builds on.
 */
export async function assertDeterministic(store: EventStore, sessionId: string): Promise<boolean> {
  const a = await rebuildState(store, sessionId);
  const b = await rebuildState(store, sessionId);
  return JSON.stringify(a) === JSON.stringify(b);
}
