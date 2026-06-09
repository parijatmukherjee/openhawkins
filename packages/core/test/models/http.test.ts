import { describe, it, expect } from "vitest";
import { parseJsonOrThrow, assertSafeBaseUrl } from "../../src/models/http.js";

describe("parseJsonOrThrow", () => {
  it("parses valid JSON", () => {
    expect(parseJsonOrThrow<{ a: number }>('{"a":1}', "ollama", 200)).toEqual({ a: 1 });
  });
  it("throws a typed, diagnosable error for a non-JSON body (not a raw SyntaxError)", () => {
    expect(() => parseJsonOrThrow("<html>503</html>", "openai", 200)).toThrow(
      /openai returned non-JSON \(200\)/,
    );
  });
});

describe("assertSafeBaseUrl", () => {
  it("allows https anywhere and http on loopback", () => {
    expect(() => assertSafeBaseUrl("https://api.openai.com/v1")).not.toThrow();
    expect(() => assertSafeBaseUrl("http://127.0.0.1:11434")).not.toThrow();
    expect(() => assertSafeBaseUrl("http://localhost:11434")).not.toThrow();
    expect(() => assertSafeBaseUrl("http://[::1]:11434")).not.toThrow();
  });
  it("rejects http to a non-loopback host (would leak the bearer key in cleartext)", () => {
    expect(() => assertSafeBaseUrl("http://api.example.com/v1")).toThrow(/requires https/);
  });
  it("throws on an unparseable URL", () => {
    expect(() => assertSafeBaseUrl("not a url")).toThrow();
  });
});
