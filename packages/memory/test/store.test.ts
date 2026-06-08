import { describe, it, expect } from "vitest";
import { VecnaStore } from "../src/store.js";

const DAY = 86_400_000;

/** A store with a deterministic id factory so assertions are stable. */
function store(): VecnaStore {
  let n = 0;
  return VecnaStore.open(":memory:", { id: () => `f-${++n}` });
}

describe("VecnaStore.remember", () => {
  it("stores a fragment with defaults and returns it", async () => {
    const s = store();
    const f = await s.remember({ text: "disk is 1136350134272 bytes free" }, 1000);
    expect(f).toEqual({
      id: "f-1",
      text: "disk is 1136350134272 bytes free",
      tags: [],
      importance: 0.5,
      trust: "tool",
      taint: false,
      createdAt: 1000,
      lastUsedAt: 1000,
      uses: 0,
    });
    s.close();
  });

  it("clamps a provided importance into [0,1]", async () => {
    const s = store();
    const hi = await s.remember({ text: "over the top free disk", importance: 1.5 }, 1);
    expect(hi.importance).toBe(1);
    const lo = await s.remember({ text: "below zero free disk", importance: -0.5 }, 1);
    expect(lo.importance).toBe(0);
    s.close();
  });

  it("honors provided tendril, tags, importance, and provenance (taint)", async () => {
    const s = store();
    const f = await s.remember(
      {
        text: "external note",
        tendril: "research",
        tags: ["web", "note"],
        importance: 0.9,
        provenance: { trust: "external", source: "web", taint: true },
      },
      5,
    );
    expect(f.tendril).toBe("research");
    expect(f.tags).toEqual(["web", "note"]);
    expect(f.importance).toBe(0.9);
    expect(f.trust).toBe("external");
    expect(f.taint).toBe(true);
    s.close();
  });
});

describe("VecnaStore.recall", () => {
  it("returns only text-relevant fragments (stopword-only matches are excluded)", async () => {
    const s = store();
    await s.remember({ text: "1136350134272 bytes are free on this machine" }, 1000);
    await s.remember({ text: "the capital of france is paris" }, 1000);

    const hits = await s.recall({
      text: "how much disk space is free on this machine?",
      now: 2000,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toContain("free on this machine");
    expect(hits[0].score).toBeGreaterThan(0);
    s.close();
  });

  it("returns [] when the query has no usable tokens", async () => {
    const s = store();
    await s.remember({ text: "anything" }, 1);
    expect(await s.recall({ text: "?! ...", now: 2 })).toEqual([]);
    s.close();
  });

  it("respects k (returns at most k fragments)", async () => {
    const s = store();
    await s.remember({ text: "free disk one" }, 1);
    await s.remember({ text: "free disk two" }, 1);
    await s.remember({ text: "free disk three" }, 1);
    const hits = await s.recall({ text: "free disk", now: 2, k: 2 });
    expect(hits).toHaveLength(2);
    s.close();
  });

  it("ranks a fresh fragment above a stale one of equal text/importance (decay)", async () => {
    const s = store();
    await s.remember({ text: "free disk stale", importance: 1 }, 0); // last_used_at = 0
    await s.remember({ text: "free disk fresh", importance: 1 }, 60 * DAY); // last_used_at later
    const hits = await s.recall({ text: "free disk", now: 60 * DAY, k: 2 });
    expect(hits[0].text).toBe("free disk fresh");
    s.close();
  });

  it("matches on provided tags and tendril context", async () => {
    const s = store();
    await s.remember({ text: "free disk reading", tendril: "system", tags: ["disk", "host"] }, 1);
    const hits = await s.recall({ text: "free disk", now: 2, tags: ["disk"], tendril: "system" });
    expect(hits).toHaveLength(1);
    expect(hits[0].tendril).toBe("system");
    expect(hits[0].tags).toEqual(["disk", "host"]);
    s.close();
  });
});

describe("VecnaStore.reinforce", () => {
  it("raises importance (capped at 1), bumps uses, and refreshes last_used_at", async () => {
    const s = store();
    await s.remember({ text: "reinforce me free disk", importance: 0.9 }, 0);
    await s.reinforce("f-1", 0.2, 5000);

    const hits = await s.recall({ text: "free disk", now: 5000 });
    expect(hits[0].importance).toBe(1); // 0.9 + 0.2 clamped to 1
    expect(hits[0].uses).toBe(1);
    expect(hits[0].lastUsedAt).toBe(5000);
    s.close();
  });

  it("floors importance at 0 for a negative delta", async () => {
    const s = store();
    await s.remember({ text: "fade me free disk", importance: 0.1 }, 0);
    await s.reinforce("f-1", -0.5, 100);
    const hits = await s.recall({ text: "free disk", now: 100 });
    expect(hits[0].importance).toBe(0);
    s.close();
  });

  it("is a no-op for an unknown id (does not throw)", async () => {
    const s = store();
    await expect(s.reinforce("nope", 0.1, 1)).resolves.toBeUndefined();
    s.close();
  });
});

describe("VecnaStore defaults", () => {
  it("generates a unique id when no id factory is injected", async () => {
    const s = VecnaStore.open(":memory:");
    const f = await s.remember({ text: "auto id free disk" });
    expect(typeof f.id).toBe("string");
    expect(f.id.length).toBeGreaterThan(0);
    // remembering again yields a different id
    const g = await s.remember({ text: "another free disk" });
    expect(g.id).not.toBe(f.id);
    s.close();
  });
});
