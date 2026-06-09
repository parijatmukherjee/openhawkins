import { describe, it, expect } from "vitest";
import {
  toMatchQuery,
  decay,
  scoreCandidate,
  rankCandidates,
  bm25ToRelevance,
  DEFAULT_WEIGHTS,
  type Candidate,
} from "../src/recall.js";
import type { Fragment } from "../src/fragment.js";

const DAY = 86_400_000;

function frag(over: Partial<Fragment>): Fragment {
  return {
    id: "f",
    text: "t",
    tags: [],
    importance: 0.5,
    trust: "tool",
    taint: false,
    createdAt: 0,
    lastUsedAt: 0,
    uses: 0,
    ...over,
  };
}

describe("toMatchQuery", () => {
  it("lowercases, extracts word tokens, dedupes, and ORs them for FTS5", () => {
    expect(toMatchQuery("How much DISK space is free? disk")).toBe("disk OR space OR free");
  });

  it("returns null when there are no usable tokens", () => {
    expect(toMatchQuery("   ?!  ")).toBeNull();
  });

  it("returns null when every token is a stopword", () => {
    expect(toMatchQuery("how is this on the")).toBeNull();
  });
});

describe("decay", () => {
  it("is 1 at age 0 and halves every half-life", () => {
    expect(decay(0, DEFAULT_WEIGHTS.halfLifeMs)).toBe(1);
    expect(decay(DEFAULT_WEIGHTS.halfLifeMs, DEFAULT_WEIGHTS.halfLifeMs)).toBeCloseTo(0.5, 10);
    expect(decay(2 * DEFAULT_WEIGHTS.halfLifeMs, DEFAULT_WEIGHTS.halfLifeMs)).toBeCloseTo(0.25, 10);
  });

  it("treats a non-positive half-life as fully decayed (no NaN)", () => {
    expect(decay(0, 0)).toBe(0);
    expect(decay(100, -1)).toBe(0);
  });
});

describe("scoreCandidate", () => {
  it("rewards a stronger match (higher relevance)", () => {
    const c1: Candidate = { fragment: frag({}), relevance: 0.9 };
    const c2: Candidate = { fragment: frag({}), relevance: 0.3 };
    const q = { now: 0 };
    expect(scoreCandidate(c1, q)).toBeGreaterThan(scoreCandidate(c2, q));
  });

  it("down-ranks a tainted fragment vs an identical clean one", () => {
    const clean: Candidate = { fragment: frag({ taint: false }), relevance: 0.5 };
    const dirty: Candidate = { fragment: frag({ taint: true }), relevance: 0.5 };
    expect(scoreCandidate(clean, { now: 0 })).toBeGreaterThan(scoreCandidate(dirty, { now: 0 }));
  });

  it("decays importance with age (a fresh fragment outranks an old one)", () => {
    // Both fragments are identical (lastUsedAt: 0); only the evaluation time `now` differs.
    const fresh: Candidate = { fragment: frag({ importance: 1, lastUsedAt: 0 }), relevance: 0.5 };
    const old: Candidate = { fragment: frag({ importance: 1, lastUsedAt: 0 }), relevance: 0.5 };
    const now = 30 * DAY;
    expect(scoreCandidate(fresh, { now: 0 })).toBeGreaterThan(scoreCandidate(old, { now }));
  });

  it("adds tag-overlap and tendril bonuses, but only for a matching tendril", () => {
    const base: Candidate = {
      fragment: frag({ tags: ["disk"], tendril: "system" }),
      relevance: 0.5,
    };
    const noBonus = scoreCandidate(base, { now: 0 });
    const withTag = scoreCandidate(base, { now: 0, tags: ["disk", "x"] });
    const withTendril = scoreCandidate(base, { now: 0, tendril: "system" });
    const wrongTendril = scoreCandidate(base, { now: 0, tendril: "research" });
    expect(withTag).toBeGreaterThan(noBonus);
    expect(withTendril).toBeGreaterThan(noBonus);
    expect(wrongTendril).toBe(noBonus); // a non-matching tendril earns no bonus
  });

  it("honors explicit weights (zeroing the text weight removes the relevance contribution)", () => {
    const c: Candidate = { fragment: frag({ importance: 0 }), relevance: 1 };
    const zeroText = scoreCandidate(c, { now: 0 }, { ...DEFAULT_WEIGHTS, text: 0 });
    expect(zeroText).toBe(0);
  });
});

describe("rankCandidates", () => {
  it("sorts by score descending and truncates to k, attaching the score", () => {
    const cands: Candidate[] = [
      { fragment: frag({ id: "weak", importance: 0 }), relevance: 0.1 },
      { fragment: frag({ id: "strong", importance: 1 }), relevance: 0.9 },
      { fragment: frag({ id: "mid", importance: 0.5 }), relevance: 0.5 },
    ];
    const ranked = rankCandidates(cands, { now: 0 }, 2);
    expect(ranked.map((r) => r.id)).toEqual(["strong", "mid"]);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("accepts explicit weights", () => {
    const cands: Candidate[] = [{ fragment: frag({ id: "only" }), relevance: 0.5 }];
    const ranked = rankCandidates(cands, { now: 0 }, 5, DEFAULT_WEIGHTS);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].id).toBe("only");
  });

  it("returns [] for a non-positive k", () => {
    const cands: Candidate[] = [{ fragment: frag({ id: "a" }), relevance: 0.5 }];
    expect(rankCandidates(cands, { now: 0 }, 0)).toEqual([]);
    expect(rankCandidates(cands, { now: 0 }, -1)).toEqual([]);
  });
});

describe("bm25ToRelevance", () => {
  it("maps FTS5 bm25 (<= 0, more negative = better) to a monotonic [0,1) relevance", () => {
    expect(bm25ToRelevance(0)).toBeCloseTo(0, 10);
    const weak = bm25ToRelevance(-0.5);
    const strong = bm25ToRelevance(-5);
    expect(strong).toBeGreaterThan(weak);
    expect(strong).toBeLessThan(1);
    expect(weak).toBeGreaterThan(0);
  });
});
