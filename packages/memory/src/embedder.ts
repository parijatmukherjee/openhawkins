/**
 * A text → vector embedder. The store uses it to embed fragments (on `remember`) and
 * queries (on `recall`), then ranks by cosine similarity. Implementations:
 * `FakeEmbedder` (deterministic, built-in) and the optional `TransformersEmbedder`.
 */
export interface Embedder {
  readonly dims: number;
  embed(text: string): Promise<Float32Array>;
}

/**
 * Cosine similarity in [-1, 1]; 0 when either vector has zero magnitude. Both
 * vectors must have the same length (a dimension mismatch is a programming error).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: length mismatch (${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * A deterministic, zero-dependency embedder: a hashed bag-of-words projected onto
 * `dims` and L2-normalized. Texts sharing word tokens get higher cosine similarity,
 * so it is meaningful for tests and the coverage gate with no model download. It is
 * NOT semantic — production uses `TransformersEmbedder`.
 */
export class FakeEmbedder implements Embedder {
  readonly dims: number;

  constructor(dims = 64) {
    this.dims = dims;
  }

  async embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(this.dims);
    for (const tok of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      v[fnv1a(tok) % this.dims] += 1;
    }
    let norm = 0;
    for (let i = 0; i < this.dims; i++) {
      norm += v[i] * v[i];
    }
    if (norm > 0) {
      const inv = 1 / Math.sqrt(norm);
      for (let i = 0; i < this.dims; i++) {
        v[i] *= inv;
      }
    }
    return v;
  }
}

/** FNV-1a 32-bit hash → non-negative integer. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
