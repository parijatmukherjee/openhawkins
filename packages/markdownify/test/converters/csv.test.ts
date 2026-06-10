import { describe, it, expect } from "vitest";
import { csvConverter } from "../../src/converters/csv.js";

describe("csvConverter", () => {
  it("accepts text/csv and .csv", () => {
    expect(csvConverter.accepts({ mime: "text/csv" })).toBe(true);
    expect(csvConverter.accepts({ ext: "csv" })).toBe(true);
    expect(csvConverter.accepts({ ext: "txt" })).toBe(false);
  });

  it("renders rows as a GitHub-flavored Markdown table", async () => {
    const { markdown } = await csvConverter.convert("name,age\nAlice,30\nBob,25");
    expect(markdown).toBe(
      ["| name | age |", "| --- | --- |", "| Alice | 30 |", "| Bob | 25 |"].join("\n"),
    );
  });

  it("escapes pipes in cells and tolerates ragged rows", async () => {
    const { markdown } = await csvConverter.convert("a,b\nx|y,z\nonly");
    expect(markdown).toContain("| x\\|y | z |");
    expect(markdown).toContain("| only |  |");
  });

  it("returns empty markdown for empty input", async () => {
    expect((await csvConverter.convert("")).markdown).toBe("");
  });

  it("handles CRLF line endings", async () => {
    const { markdown } = await csvConverter.convert("a,b\r\nc,d");
    expect(markdown).toBe(["| a | b |", "| --- | --- |", "| c | d |"].join("\n"));
  });

  it("handles quoted fields containing commas, quotes, and newlines", async () => {
    const { markdown } = await csvConverter.convert('a,b\n"x,y","he said ""hi"""\n"line\nbreak",z');
    expect(markdown).toContain('| x,y | he said "hi" |');
    // an embedded newline becomes <br> so the cell stays on one physical table row
    expect(markdown).toContain("| line<br>break | z |");
    expect(markdown).not.toContain("line\nbreak");
  });

  it("handles a very large CSV without a RangeError (no argument-count spread)", async () => {
    // 200k single-column rows: `Math.max(...rows.map(...))` spreads 200k args and throws
    // RangeError on V8; `reduce` is unbounded. Build the input cheaply.
    const big = Array.from({ length: 200_000 }, (_, i) => `r${i}`).join("\n");
    const { markdown } = await csvConverter.convert(big);
    expect(markdown.startsWith("| r0 |")).toBe(true); // header is the first row
    expect(markdown.split("\n")).toHaveLength(200_001); // header + sep + 199_999 body rows
  });
});
