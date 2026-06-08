import type { Fragment, ScoredFragment } from "./fragment.js";

/** Tunable weights for the blended recall score. Fixed constants in S2. */
export interface RecallWeights {
  text: number;
  importance: number;
  tags: number;
  taintPenalty: number;
  tendrilBonus: number;
  halfLifeMs: number;
}

export const DEFAULT_WEIGHTS: RecallWeights = {
  text: 1,
  importance: 1,
  tags: 0.5,
  taintPenalty: 0.5,
  tendrilBonus: 0.25,
  halfLifeMs: 7 * 86_400_000, // 7 days
};

/** A fragment paired with its raw FTS5 bm25 score (lower/more-negative = better). */
export interface Candidate {
  fragment: Fragment;
  bm25: number;
}

/** What the query contributes to scoring, beyond the text match. */
export interface RecallContext {
  now: number;
  tags?: string[];
  tendril?: string;
}

/**
 * Exponential decay in [0,1]: 1 at age 0, halving every half-life. A non-positive
 * half-life is treated as fully decayed (0) rather than producing NaN/Infinity.
 * `ageMs` is expected to be >= 0 (callers clamp); a negative age yields a value > 1.
 */
export function decay(ageMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) {
    return 0;
  }
  return 0.5 ** (ageMs / halfLifeMs);
}

/**
 * Common English function words dropped from FTS5 queries: matching on them
 * surfaces irrelevant fragments (e.g. any text containing "is"). Content words
 * carry the relevance signal. Not exhaustive — the lexical baseline is superseded
 * by semantic (embedding) recall in S2.3.
 */
const STOPWORDS = new Set<string>([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "do",
  "does",
  "did",
  "for",
  "from",
  "how",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "many",
  "me",
  "much",
  "my",
  "of",
  "on",
  "or",
  "over",
  "that",
  "the",
  "their",
  "then",
  "there",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "you",
  "your",
  "we",
  "us",
  "i",
]);

/**
 * Build an FTS5 MATCH expression from free text: lowercase, extract word tokens,
 * drop stopwords, dedupe, and OR the rest so any content term can match. Returns
 * null if no usable token remains — the caller then skips the FTS query.
 */
export function toMatchQuery(text: string): string | null {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const m of text.toLowerCase().matchAll(/[a-z0-9]+/g)) {
    const tok = m[0];
    if (STOPWORDS.has(tok) || seen.has(tok)) {
      continue;
    }
    seen.add(tok);
    tokens.push(tok);
  }
  return tokens.length > 0 ? tokens.join(" OR ") : null;
}

/** Blended relevance score (higher = more relevant). Pure function. */
export function scoreCandidate(
  c: Candidate,
  ctx: RecallContext,
  w: RecallWeights = DEFAULT_WEIGHTS,
): number {
  // text is unbounded (−bm25 can reach ~10–20 for multi-term FTS5 matches) while
  // importance·decay and tag overlap are in [0,1]; text dominates by design here
  // (FTS5 already guarantees relevance). Weight tuning is deferred to S3.
  const text = w.text * -c.bm25;
  const age = Math.max(0, ctx.now - c.fragment.lastUsedAt);
  const importance = w.importance * c.fragment.importance * decay(age, w.halfLifeMs);
  const tags = w.tags * tagOverlap(ctx.tags ?? [], c.fragment.tags);
  const taint = c.fragment.taint ? w.taintPenalty : 0;
  const tendril =
    ctx.tendril !== undefined && ctx.tendril === c.fragment.tendril ? w.tendrilBonus : 0;
  return text + importance + tags - taint + tendril;
}

/** Score every candidate, sort by score descending, attach the score, take top k. */
export function rankCandidates(
  candidates: Candidate[],
  ctx: RecallContext,
  k: number,
  w: RecallWeights = DEFAULT_WEIGHTS,
): ScoredFragment[] {
  if (k <= 0) {
    return [];
  }
  return candidates
    .map((c) => ({ ...c.fragment, score: scoreCandidate(c, ctx, w) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/** Fraction of the query's tags present on the fragment, in [0,1]. */
function tagOverlap(queryTags: string[], fragmentTags: string[]): number {
  if (queryTags.length === 0) {
    return 0;
  }
  const have = new Set(fragmentTags);
  const hits = queryTags.reduce((n, t) => (have.has(t) ? n + 1 : n), 0);
  return hits / queryTags.length;
}
