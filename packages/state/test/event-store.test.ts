import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Session, rebuildState, fixedClock } from "@openhawkins/core";
import { SqliteEventStore } from "../src/event-store.js";

const dbPath = (): string => join(mkdtempSync(join(tmpdir(), "oh-state-")), "oh.sqlite");

describe("SqliteEventStore (VINES)", () => {
  it("appends and reads events back in order, scoped by session", async () => {
    const store = SqliteEventStore.open(":memory:");
    await store.append({ type: "SessionStarted", sessionId: "s-1", agentId: "a", at: 1 });
    await store.append({
      type: "TurnStarted",
      sessionId: "s-1",
      turnId: "t-1",
      input: "hi",
      at: 2,
    });
    await store.append({ type: "SessionStarted", sessionId: "other", agentId: "b", at: 3 });

    const events = await store.read("s-1");
    expect(events.map((e) => e.type)).toEqual(["SessionStarted", "TurnStarted"]);
    expect(await store.read("missing")).toEqual([]);
    store.close();
  });

  it("reads events in paginated chunks with limit and afterSeq", async () => {
    const store = SqliteEventStore.open(":memory:");
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

    // seq is 1-based in SQLite AUTOINCREMENT; first two events are seq 1, 2
    const chunk2 = await store.read("s-1", { limit: 2, afterSeq: 2 });
    expect(chunk2).toHaveLength(2);
    expect((chunk2[0] as { turnId: string }).turnId).toBe("t2");

    const chunk3 = await store.read("s-1", { limit: 2, afterSeq: 4 });
    expect(chunk3).toHaveLength(1);
    expect((chunk3[0] as { turnId: string }).turnId).toBe("t4");
    store.close();
  });

  it("durably persists a session that replays to identical state after reopen", async () => {
    const path = dbPath();

    const store = SqliteEventStore.open(path);
    const session = await Session.start({
      sessionId: "s-1",
      agentId: "probe-agent",
      store,
      clock: fixedClock(0),
    });
    await session.runTurn("ping", async () => "pong");
    const liveState = session.state;
    store.close(); // simulate process exit

    // Fresh handle on the same file — as if a new process started up.
    const reopened = SqliteEventStore.open(path);
    try {
      const replayed = await rebuildState(reopened, "s-1");
      expect(replayed).toEqual(liveState);
      expect(replayed.turns).toEqual([{ id: "s-1-turn-1", input: "ping", final: "pong" }]);
    } finally {
      reopened.close();
    }
  });
});
