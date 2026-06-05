import { describe, it, expect } from "vitest";
import { systemClock, fixedClock } from "../../src/util/clock.js";

describe("clock", () => {
  it("systemClock returns a number close to Date.now()", () => {
    const before = Date.now();
    const t = systemClock();
    expect(t).toBeGreaterThanOrEqual(before);
  });

  it("fixedClock returns a constant, then can be advanced", () => {
    const clock = fixedClock(1000);
    expect(clock()).toBe(1000);
    clock.advance(5);
    expect(clock()).toBe(1005);
  });
});
