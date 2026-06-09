import { describe, it, expect } from "vitest";
import { jsonConverter } from "../../src/converters/json.js";

describe("jsonConverter", () => {
  it("accepts application/json and .json", () => {
    expect(jsonConverter.accepts({ mime: "application/json" })).toBe(true);
    expect(jsonConverter.accepts({ ext: "json" })).toBe(true);
    expect(jsonConverter.accepts({ mime: "text/plain" })).toBe(false);
  });

  it("pretty-prints valid JSON inside a fenced block", async () => {
    const { markdown } = await jsonConverter.convert('{"a":1,"b":[2,3]}');
    expect(markdown).toBe('```json\n{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n```');
  });

  it("falls back to a fenced raw block for invalid JSON", async () => {
    const { markdown } = await jsonConverter.convert("{not json");
    expect(markdown).toBe("```\n{not json\n```");
  });
});
