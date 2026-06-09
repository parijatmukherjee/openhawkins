import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { TransformersEmbedder } from "../src/transformers-embedder.js";
import { cosineSimilarity } from "../src/embedder.js";

// Opt-in: only runs when @huggingface/transformers is actually installed. CI does not
// install the optional peer dep, so this is skipped there (and is slow — it downloads
// a model on first run). This mirrors S1's live-Ollama opt-in pattern.
function transformersInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve("@huggingface/transformers");
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!transformersInstalled())("TransformersEmbedder (opt-in, real model)", () => {
  it("embeds text to a unit-ish vector and ranks related text above unrelated", async () => {
    const e = new TransformersEmbedder();
    const q = await e.embed("how much disk space is free");
    const related = await e.embed("the available free storage on the machine");
    const unrelated = await e.embed("the capital of france is paris");
    expect(q.length).toBe(384);
    expect(cosineSimilarity(q, related)).toBeGreaterThan(cosineSimilarity(q, unrelated));
  }, 120000);
});
