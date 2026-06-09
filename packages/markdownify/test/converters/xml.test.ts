import { describe, it, expect } from "vitest";
import { xmlConverter } from "../../src/converters/xml.js";

describe("xmlConverter", () => {
  it("accepts xml mimes and .xml", () => {
    expect(xmlConverter.accepts({ mime: "application/xml" })).toBe(true);
    expect(xmlConverter.accepts({ mime: "text/xml" })).toBe(true);
    expect(xmlConverter.accepts({ ext: "xml" })).toBe(true);
    expect(xmlConverter.accepts({ ext: "csv" })).toBe(false);
  });

  it("renders nested elements as nested Markdown bullet lists", async () => {
    const { markdown } = await xmlConverter.convert(
      "<note><to>Bob</to><body>hi there</body></note>",
    );
    expect(markdown).toContain("- **note**");
    expect(markdown).toContain("  - **to**: Bob");
    expect(markdown).toContain("  - **body**: hi there");
  });

  it("renders repeated elements (arrays) as sibling bullets", async () => {
    const { markdown } = await xmlConverter.convert("<list><item>a</item><item>b</item></list>");
    expect(markdown).toContain("  - **item**: a");
    expect(markdown).toContain("  - **item**: b");
  });

  it("renders an element's own text as its value when it also has children", async () => {
    const { markdown } = await xmlConverter.convert("<r>lead text<child>v</child></r>");
    expect(markdown).toContain("- **r**: lead text");
    expect(markdown).toContain("  - **child**: v");
    // the parser's internal "#text" key must not surface as a bullet
    expect(markdown).not.toContain("#text");
  });

  it("renders coerced numeric and boolean values as their text", async () => {
    const { markdown } = await xmlConverter.convert("<r><n>42</n><b>true</b></r>");
    expect(markdown).toContain("  - **n**: 42");
    expect(markdown).toContain("  - **b**: true");
  });

  it("degrades to a fenced block for unparseable XML", async () => {
    const { markdown } = await xmlConverter.convert("<a><b></a>");
    expect(markdown).toBe("```\n<a><b></a>\n```");
  });
});
