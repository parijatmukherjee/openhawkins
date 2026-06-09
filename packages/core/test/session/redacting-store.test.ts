import { describe, it, expect } from "vitest";
import { RedactingEventStore } from "../../src/session/redacting-store.js";
import { InMemoryEventStore, type DomainEvent } from "../../src/session/events.js";

describe("RedactingEventStore", () => {
  it("redacts secret-shaped event payload fields on append; reads them back redacted", async () => {
    const inner = new InMemoryEventStore();
    const store = new RedactingEventStore(inner);
    await store.append({
      type: "TurnStarted",
      sessionId: "s1",
      turnId: "t1",
      input: "my key is sk-abcdefgh12345 ok",
      at: 1,
    } as DomainEvent);
    const [ev] = await store.read("s1");
    expect(JSON.stringify(ev)).not.toContain("sk-abcdefgh12345");
    expect((ev as { sessionId: string }).sessionId).toBe("s1");
    expect((ev as { type: string }).type).toBe("TurnStarted");
  });

  it("read passes through and preserves order + sessionId filtering", async () => {
    const store = new RedactingEventStore(new InMemoryEventStore());
    await store.append({
      type: "SessionStarted",
      sessionId: "a",
      agentId: "x",
      at: 1,
    } as DomainEvent);
    await store.append({
      type: "SessionStarted",
      sessionId: "b",
      agentId: "y",
      at: 2,
    } as DomainEvent);
    expect((await store.read("a")).length).toBe(1);
    expect((await store.read("b")).length).toBe(1);
  });
});
