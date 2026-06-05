import { describe, it, expect } from "vitest";
import { InMemoryEventStore, type DomainEvent } from "../../src/session/events.js";

const ev = (seq: number): DomainEvent => ({
  type: "SessionStarted",
  sessionId: "s-1",
  agentId: "probe-agent",
  at: seq,
});

describe("InMemoryEventStore", () => {
  it("appends and reads back events in order, scoped by session", async () => {
    const store = new InMemoryEventStore();
    await store.append(ev(1));
    await store.append({
      type: "TurnStarted",
      sessionId: "s-1",
      turnId: "t-1",
      input: "hi",
      at: 2,
    });
    const events = await store.read("s-1");
    expect(events.map((e) => e.type)).toEqual(["SessionStarted", "TurnStarted"]);
  });

  it("isolates events by sessionId", async () => {
    const store = new InMemoryEventStore();
    await store.append(ev(1));
    expect(await store.read("other")).toEqual([]);
  });
});
