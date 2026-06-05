import { describe, it, expect } from "vitest";
import { createIdFactory } from "../../src/util/ids.js";

describe("createIdFactory", () => {
  it("produces prefixed, monotonically increasing ids", () => {
    const id = createIdFactory("turn");
    expect(id()).toBe("turn-1");
    expect(id()).toBe("turn-2");
  });

  it("separate factories have independent counters", () => {
    const a = createIdFactory("s");
    const b = createIdFactory("s");
    expect(a()).toBe("s-1");
    expect(b()).toBe("s-1");
  });
});
