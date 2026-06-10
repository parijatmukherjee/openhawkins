import { describe, it, expect } from "vitest";
import { Session } from "../../src/session/session.js";
import { InMemoryEventStore } from "../../src/session/events.js";
import { fixedClock } from "../../src/util/clock.js";
import {
  rebuildState,
  assertDeterministic,
  rebuildStateStreaming,
} from "../../src/session/replay.js";

describe("replay", () => {
  it("rebuildState reconstructs the live session state from the event log", async () => {
    const store = new InMemoryEventStore();
    const session = await Session.start({
      sessionId: "s-1",
      agentId: "probe-agent",
      store,
      clock: fixedClock(0),
    });
    await session.runTurn("ping", async () => "pong");

    const replayed = await rebuildState(store, "s-1");
    expect(replayed).toEqual(session.state);
  });

  it("assertDeterministic passes for a recorded log (same events -> same state)", async () => {
    const store = new InMemoryEventStore();
    const session = await Session.start({
      sessionId: "s-1",
      agentId: "probe-agent",
      store,
      clock: fixedClock(0),
    });
    await session.runTurn("ping", async () => "pong");

    await expect(assertDeterministic(store, "s-1")).resolves.toBe(true);
  });

  it("rebuildStateStreaming produces identical state to rebuildState", async () => {
    const store = new InMemoryEventStore();
    const session = await Session.start({
      sessionId: "s-1",
      agentId: "probe-agent",
      store,
      clock: fixedClock(0),
    });
    await session.runTurn("ping", async () => "pong");
    await session.runTurn("hello", async () => "world");

    const full = await rebuildState(store, "s-1");
    const streaming = await rebuildStateStreaming(store, "s-1", 2); // tiny chunk to force pagination
    expect(streaming).toEqual(full);
  });
});
