import { describe, it, expect } from "vitest";
import { markdownify } from "../src/markdownify.js";

describe("markdownify (default registry)", () => {
  it("routes HTML, CSV, JSON, XML, and plain text", async () => {
    expect((await markdownify({ data: "<h1>Hi</h1>", mime: "text/html" })).markdown).toContain(
      "# Hi",
    );
    expect((await markdownify({ data: "a,b\n1,2", filename: "x.csv" })).markdown).toContain(
      "| a | b |",
    );
    expect((await markdownify({ data: '{"k":1}', mime: "application/json" })).format).toBe("json");
    expect((await markdownify({ data: "<r><c>v</c></r>", filename: "x.xml" })).markdown).toContain(
      "**r**",
    );
    expect(await markdownify({ data: "just text" })).toEqual({
      markdown: "just text",
      format: "text",
      warnings: [],
    });
  });

  it("routes by content sniff when there is no mime or extension", async () => {
    expect((await markdownify({ data: "<p>x</p>" })).format).toBe("html");
    expect((await markdownify({ data: '{"a":1}' })).format).toBe("json");
  });
});
