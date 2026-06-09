import { describe, it, expect } from "vitest";
import { htmlConverter } from "../../src/converters/html.js";

describe("htmlConverter", () => {
  it("accepts text/html and .html/.htm", () => {
    expect(htmlConverter.accepts({ mime: "text/html" })).toBe(true);
    expect(htmlConverter.accepts({ ext: "htm" })).toBe(true);
    expect(htmlConverter.accepts({ ext: "html" })).toBe(true);
    expect(htmlConverter.accepts({ mime: "text/plain" })).toBe(false);
    expect(htmlConverter.format).toBe("html");
  });

  it("converts headings, emphasis, and links to Markdown", async () => {
    const html = "<h1>Title</h1><p>Hello <strong>world</strong> <a href='/x'>link</a></p>";
    const { markdown } = await htmlConverter.convert(html);
    expect(markdown).toContain("# Title");
    expect(markdown).toContain("**world**");
    expect(markdown).toContain("[link](/x)");
  });

  it("decodes byte input", async () => {
    const bytes = new TextEncoder().encode("<h2>Sub</h2>");
    expect((await htmlConverter.convert(bytes)).markdown).toContain("## Sub");
  });

  it("uses the first heading as the title", async () => {
    expect((await htmlConverter.convert("<h1>My Doc</h1><p>x</p>")).title).toBe("My Doc");
    expect((await htmlConverter.convert("<p>no heading</p>")).title).toBeUndefined();
  });

  it("ignores an empty heading when picking a title", async () => {
    expect((await htmlConverter.convert("<h1></h1><p>body</p>")).title).toBeUndefined();
  });

  it("decodes HTML entities in the title, consistent with the body", async () => {
    const { markdown, title } = await htmlConverter.convert("<h1>Tom &amp; Jerry</h1><p>x</p>");
    expect(title).toBe("Tom & Jerry");
    expect(markdown).toContain("# Tom & Jerry");
  });
});
