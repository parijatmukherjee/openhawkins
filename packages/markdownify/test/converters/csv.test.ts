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
});
