import { describe, it, expect } from "vitest";
import { OllamaAdapter } from "../../src/models/ollama.js";
import type { HttpFetch, HttpRequestInit } from "../../src/models/http.js";

/** Capture the outgoing request and reply with a canned body, like a real server. */
function stubHttp(responseBody: unknown, status = 200): { http: HttpFetch; seen: () => Captured } {
  let captured: Captured | undefined;
  const http: HttpFetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) as Record<string, unknown> };
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(responseBody),
    };
  };
  return { http, seen: () => captured! };
}

interface Captured {
  url: string;
  init: HttpRequestInit;
  body: Record<string, unknown>;
}

describe("OllamaAdapter", () => {
  it("posts to the local /api/chat with mapped messages + tools and parses text", async () => {
    const { http, seen } = stubHttp({ message: { content: "hello there", tool_calls: [] } });
    const adapter = new OllamaAdapter({ model: "llama3.1", http });

    const res = await adapter.generate({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "disk_free", description: "free bytes", parameters: { type: "object" } }],
    });

    expect(res).toEqual({ content: "hello there", toolCalls: [] });
    const req = seen();
    expect(req.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(req.init.method).toBe("POST");
    expect(req.body.stream).toBe(false);
    expect(req.body.model).toBe("llama3.1");
    expect((req.body.tools as unknown[]).length).toBe(1);
    // no api key locally => no auth header
    expect(req.init.headers.authorization).toBeUndefined();
  });

  it("parses native tool_calls and synthesizes stable positional ids", async () => {
    const { http } = stubHttp({
      message: {
        content: "",
        tool_calls: [{ function: { name: "disk_free", arguments: { path: "/" } } }],
      },
    });
    const adapter = new OllamaAdapter({ model: "llama3.1", http });

    const res = await adapter.generate({ messages: [{ role: "user", content: "disk?" }] });
    expect(res.toolCalls).toEqual([{ id: "oc-1", tool: "disk_free", args: { path: "/" } }]);
  });

  it("sends a bearer auth header for cloud (base url + api key, one code path)", async () => {
    const { http, seen } = stubHttp({ message: { content: "ok" } });
    const adapter = new OllamaAdapter({
      model: "gpt-oss:120b",
      baseUrl: "https://ollama.com",
      apiKey: "sk-cloud-123",
      http,
    });

    await adapter.generate({ messages: [{ role: "user", content: "hi" }] });
    const req = seen();
    expect(req.url).toBe("https://ollama.com/api/chat");
    expect(req.init.headers.authorization).toBe("Bearer sk-cloud-123");
  });

  it("passes responseSchema through as Ollama `format` (structured output)", async () => {
    const { http, seen } = stubHttp({ message: { content: "{}" } });
    const adapter = new OllamaAdapter({ model: "llama3.1", http });
    const schema = { type: "object", properties: { n: { type: "number" } } };

    await adapter.generate({ messages: [{ role: "user", content: "n?" }], responseSchema: schema });
    expect(seen().body.format).toEqual(schema);
  });

  it("throws with the server body on a non-2xx response", async () => {
    const { http } = stubHttp({ error: "model not found" }, 404);
    const adapter = new OllamaAdapter({ model: "nope", http });
    await expect(adapter.generate({ messages: [] })).rejects.toThrow(
      /ollama request failed \(404\)/,
    );
  });

  it("honors explicit timeout/retry config on the happy path (one attempt, no abort)", async () => {
    const { http } = stubHttp({ message: { content: "ok" } });
    const adapter = new OllamaAdapter({
      model: "llama3.1",
      http,
      timeoutMs: 5,
      retries: 1,
      retryBaseMs: 0,
    });
    const res = await adapter.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(res.content).toBe("ok");
  });

  it("throws a diagnosable error for a 502 HTML response", async () => {
    const html = "<html><body>502 Bad Gateway</body></html>";
    const http: HttpFetch = async () => ({
      ok: false,
      status: 502,
      text: async () => html,
    });
    const adapter = new OllamaAdapter({ model: "llama3.1", http });
    await expect(adapter.generate({ messages: [] })).rejects.toThrow(
      /ollama returned non-JSON \(502\)/,
    );
  });
});
