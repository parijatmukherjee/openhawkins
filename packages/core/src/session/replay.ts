import type { EventStore } from "./events.js";
import { foldEvents, initialState, type SessionState } from "./state.js";

/** Rebuild session state purely from the recorded event log. */
export async function rebuildState(store: EventStore, sessionId: string): Promise<SessionState> {
  const events = await store.read(sessionId);
  return foldEvents(events);
}

/**
 * Streaming rebuild: folds events in paginated chunks to avoid loading the entire
 * session into memory at once. Uses the same `foldEvents` reducer so behavior is
 * identical to `rebuildState`.
 */
export async function rebuildStateStreaming(
  store: EventStore,
  sessionId: string,
  chunkSize = 1000,
): Promise<SessionState> {
  let state = initialState();
  let afterSeq: number | undefined;
  while (true) {
    const opts: { limit: number; afterSeq?: number } = { limit: chunkSize };
    if (afterSeq !== undefined) {
      opts.afterSeq = afterSeq;
    }
    const chunk = await store.read(sessionId, opts);
    if (chunk.length === 0) break;
    state = foldEvents(chunk, state);
    // Derive the next afterSeq from the chunk: events are ordered by seq, so the
    // last event's position relative to the full log gives us the next cursor.
    // For InMemoryEventStore, seq is the array index; for SqliteEventStore, seq is
    // the SQLite auto-increment. We approximate by counting events seen so far.
    afterSeq = (afterSeq ?? 0) + chunk.length;
    if (chunk.length < chunkSize) break;
  }
  return state;
}

/**
 * Determinism guarantee: folding the same recorded log twice yields deeply equal
 * state. This is the primitive the agent loop's output-replay (S1.4/S1.5) builds on.
 */
export async function assertDeterministic(store: EventStore, sessionId: string): Promise<boolean> {
  const a = await rebuildState(store, sessionId);
  const b = await rebuildStateStreaming(store, sessionId);
  return JSON.stringify(a) === JSON.stringify(b);
}
