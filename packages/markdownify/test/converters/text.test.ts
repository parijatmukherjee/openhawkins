import { describe, it, expect } from "vitest";
import { textConverter } from "../../src/converters/text.js";

describe("textConverter", () => {
  it("passes a string through unchanged", async () => {
    expect(await textConverter.convert("hello\nworld")).toEqual({ markdown: "hello\nworld" });
  });
  it("decodes bytes as UTF-8", async () => {
    const bytes = new TextEncoder().encode("héllo");
    expect(await textConverter.convert(bytes)).toEqual({ markdown: "héllo" });
  });
  it("accepts anything (it is the fallback)", () => {
    expect(textConverter.accepts({ mime: "anything/at-all" })).toBe(true);
    expect(textConverter.accepts({})).toBe(true);
    expect(textConverter.format).toBe("text");
  });
});
