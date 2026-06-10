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

  it("reads events in paginated chunks", async () => {
    const store = new InMemoryEventStore();
    for (let i = 0; i < 5; i++) {
      await store.append({
        type: "TurnStarted",
        sessionId: "s-1",
        turnId: `t${i}`,
        input: `msg-${i}`,
        at: i,
      });
    }
    const chunk1 = await store.read("s-1", { limit: 2 });
    expect(chunk1).toHaveLength(2);
    expect((chunk1[0] as { turnId: string }).turnId).toBe("t0");
    expect((chunk1[1] as { turnId: string }).turnId).toBe("t1");

    const chunk2 = await store.read("s-1", { limit: 2, afterSeq: 2 });
    expect(chunk2).toHaveLength(2);
    expect((chunk2[0] as { turnId: string }).turnId).toBe("t2");
    expect((chunk2[1] as { turnId: string }).turnId).toBe("t3");

    const chunk3 = await store.read("s-1", { limit: 2, afterSeq: 4 });
    expect(chunk3).toHaveLength(1);
    expect((chunk3[0] as { turnId: string }).turnId).toBe("t4");
  });
});
