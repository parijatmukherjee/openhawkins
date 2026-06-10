interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, TokenBucket>();

export interface TokenBucketOptions {
  capacity: number;
  refillRate: number; // tokens per second
}

export function tokenBucket(
  key: string,
  opts: TokenBucketOptions,
): { allow(): boolean } {
  return {
    allow(): boolean {
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: opts.capacity, lastRefill: now };
        buckets.set(key, bucket);
      }
      const elapsed = (now - bucket.lastRefill) / 1000;
      bucket.tokens = Math.min(opts.capacity, bucket.tokens + elapsed * opts.refillRate);
      bucket.lastRefill = now;
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return true;
      }
      return false;
    },
  };
}
