import { describe, it, expect } from "vitest";
import * as memory from "../src/index.js";

describe("@openhawkins/memory public surface", () => {
  it("re-exports the VECNA building blocks", () => {
    for (const name of ["VecnaStore", "MEMORY_SCHEMA", "rankCandidates", "toMatchQuery"] as const) {
      expect(memory, `missing export: ${name}`).toHaveProperty(name);
    }
  });
});
