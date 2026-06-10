import { describe, it, expect } from "vitest";
import { parseJsonOrThrow, assertSafeBaseUrl } from "../../src/models/http.js";
import { requestWithTimeout, withRetry, type HttpFetch } from "../../src/models/http.js";

const okResponse = (text = "{}") => ({ ok: true, status: 200, text: async () => text });

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

describe("requestWithTimeout", () => {
  it("returns the response when the call resolves in time", async () => {
    const http: HttpFetch = async () => okResponse();
    const res = await requestWithTimeout(
      http,
      "https://x",
      { method: "POST", headers: {}, body: "" },
      50,
    );
    expect(res.ok).toBe(true);
  });
  it("aborts and throws a timeout error when the call exceeds the deadline", async () => {
    const hang: HttpFetch = (_u, init) =>
      new Promise((_res, rej) =>
        init.signal?.addEventListener("abort", () => rej(new Error("aborted"))),
      );
    await expect(
      requestWithTimeout(hang, "https://x", { method: "POST", headers: {}, body: "" }, 10),
    ).rejects.toThrow(/timed out/);
  });
  it("rethrows a non-timeout error unchanged (signal not aborted)", async () => {
    const boom: HttpFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    await expect(
      requestWithTimeout(boom, "https://x", { method: "POST", headers: {}, body: "" }, 50),
    ).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("withRetry", () => {
  it("retries a transient failure then succeeds", async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        if (n++ < 2) throw new Error("ECONNRESET");
        return "ok";
      },
      { retries: 3, baseDelayMs: 0 },
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });
  it("gives up after exhausting retries, surfacing the last error", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new Error("down");
        },
        { retries: 2, baseDelayMs: 0 },
      ),
    ).rejects.toThrow(/down/);
    expect(n).toBe(3); // initial + 2 retries
  });

  it("retries on ECONNRESET network errors", async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        if (n++ < 2) {
          const err = new Error("read ECONNRESET") as Error & { code: string };
          err.code = "ECONNRESET";
          throw err;
        }
        return "ok";
      },
      { retries: 3, baseDelayMs: 0 },
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });
});
