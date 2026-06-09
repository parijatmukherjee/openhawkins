import { describe, it, expect } from "vitest";
import { FakeEmbedder, cosineSimilarity } from "../src/embedder.js";

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors, 0 for orthogonal, -1 for opposite", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    const c = new Float32Array([-1, 0, 0]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 10);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10);
    expect(cosineSimilarity(a, c)).toBeCloseTo(-1, 10);
  });

  it("is 0 when either vector has zero magnitude", () => {
    expect(cosineSimilarity(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
    expect(cosineSimilarity(new Float32Array([1, 1]), new Float32Array([0, 0]))).toBe(0);
  });

  it("throws on a dimension mismatch", () => {
    expect(() => cosineSimilarity(new Float32Array([1, 0]), new Float32Array([1, 0, 0]))).toThrow(
      /length mismatch/,
    );
  });
});

describe("FakeEmbedder", () => {
  it("returns a unit-length vector of the configured dims", async () => {
    const e = new FakeEmbedder(32);
    const v = await e.embed("disk free");
    expect(e.dims).toBe(32);
    expect(v).toBeInstanceOf(Float32Array);
    expect(v.length).toBe(32);
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 6);
  });

  it("is deterministic — same text yields the same vector", async () => {
    const e = new FakeEmbedder();
    expect(Array.from(await e.embed("hello world"))).toEqual(
      Array.from(await e.embed("hello world")),
    );
  });

  it("gives higher cosine to texts sharing tokens than to disjoint ones", async () => {
    const e = new FakeEmbedder(64);
    const q = await e.embed("how much disk space is free");
    const related = await e.embed("the machine has free disk space");
    const unrelated = await e.embed("the capital of france is paris");
    expect(cosineSimilarity(q, related)).toBeGreaterThan(cosineSimilarity(q, unrelated));
  });

  it("returns the zero vector for text with no word tokens", async () => {
    const v = await new FakeEmbedder(8).embed("!?  ...");
    expect(Array.from(v)).toEqual(new Array(8).fill(0));
  });
});
