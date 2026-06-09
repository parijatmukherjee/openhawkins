import { describe, it, expect } from "vitest";
import { extOf, sniff } from "../src/detect.js";

describe("extOf", () => {
  it("returns the lowercased extension without the dot", () => {
    expect(extOf("Report.HTML")).toBe("html");
    expect(extOf("/a/b/data.csv")).toBe("csv");
  });
  it("returns undefined when there is no usable extension", () => {
    expect(extOf("noext")).toBeUndefined();
    expect(extOf(undefined)).toBeUndefined();
    expect(extOf("trailingdot.")).toBeUndefined();
  });
});

describe("sniff", () => {
  it("detects xml, html, and json from leading content", () => {
    expect(sniff('<?xml version="1.0"?><a/>')).toBe("xml");
    expect(sniff("  <!DOCTYPE html><html></html>")).toBe("html");
    expect(sniff("<div>hi</div>")).toBe("html");
    expect(sniff('  {"a":1}')).toBe("json");
    expect(sniff("[1,2,3]")).toBe("json");
  });
  it("returns undefined for plain prose", () => {
    expect(sniff("just some text")).toBeUndefined();
  });
});
