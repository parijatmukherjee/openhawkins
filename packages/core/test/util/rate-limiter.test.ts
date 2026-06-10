import { describe, it, expect } from "vitest";
import { tokenBucket } from "../../src/util/rate-limiter.js";

describe("tokenBucket", () => {
  it("allows requests within capacity and denies excess", () => {
    const limiter = tokenBucket("key1", { capacity: 2, refillRate: 1 });
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(false);
  });

  it("refills tokens over time", async () => {
    const limiter = tokenBucket("key2", { capacity: 1, refillRate: 10 }); // 10 per second
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(false);
    await new Promise((r) => setTimeout(r, 150));
    expect(limiter.allow()).toBe(true);
  });

  it("isolates keys", () => {
    const a = tokenBucket("a", { capacity: 1, refillRate: 1 });
    const b = tokenBucket("b", { capacity: 1, refillRate: 1 });
    expect(a.allow()).toBe(true);
    expect(b.allow()).toBe(true);
  });
});
