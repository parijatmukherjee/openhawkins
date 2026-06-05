import { describe, it, expect } from "vitest";
import { Session } from "../../src/session/session.js";
import { InMemoryEventStore } from "../../src/session/events.js";
import { fixedClock } from "../../src/util/clock.js";

describe("Session (single-writer)", () => {
  it("records a turn as TurnStarted + TurnEnded and exposes folded state", async () => {
    const store = new InMemoryEventStore();
    const clock = fixedClock(100);
    const session = await Session.start({ sessionId: "s-1", agentId: "probe-agent", store, clock });

    await session.runTurn("ping", async () => "pong");

    expect(session.state.turns).toEqual([{ id: "s-1-turn-1", input: "ping", final: "pong" }]);
    const types = (await store.read("s-1")).map((e) => e.type);
    expect(types).toEqual(["SessionStarted", "TurnStarted", "TurnEnded"]);
  });

  it("serializes concurrent turns — no interleaving (single writer)", async () => {
    const store = new InMemoryEventStore();
    const session = await Session.start({
      sessionId: "s-2",
      agentId: "probe-agent",
      store,
      clock: fixedClock(0),
    });

    const order: string[] = [];
    const slow = session.runTurn("a", async () => {
      order.push("a:start");
      await new Promise((r) => setTimeout(r, 20));
      order.push("a:end");
      return "A";
    });
    const fast = session.runTurn("b", async () => {
      order.push("b:start");
      return "B";
    });

    await Promise.all([slow, fast]);
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
    expect(session.state.turns.map((t) => t.final)).toEqual(["A", "B"]);
  });
});
