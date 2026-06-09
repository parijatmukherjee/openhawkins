import { describe, it, expect } from "vitest";
import * as api from "../src/index.js";

// Exercises the public barrel (src/index.ts) and asserts the package's entry point
// re-exports its surface — so a consumer importing "@openhawkins/markdownify" gets
// markdownify(), the registry, and the types in one place.
describe("@openhawkins/markdownify public API", () => {
  it("re-exports markdownify() and ConverterRegistry from the barrel", async () => {
    expect(typeof api.markdownify).toBe("function");
    expect(typeof api.ConverterRegistry).toBe("function");
    expect(typeof api.defaultRegistry).toBe("function");
  });

  it("markdownify() reached through the barrel converts a document", async () => {
    const res = await api.markdownify({ data: "<h1>Hi</h1>", mime: "text/html" });
    expect(res.markdown).toContain("# Hi");
    expect(res.format).toBe("html");
  });
});
