import { describe, it, expect } from "vitest";
import { OllamaAdapter } from "../../src/models/ollama.js";
import { OpenAiCompatAdapter } from "../../src/models/openai-compat.js";
import { defaultHttp, type HttpFetch } from "../../src/models/http.js";

function stub(responseBody: unknown): { http: HttpFetch; body: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  const http: HttpFetch = async (_url, init) => {
    captured = JSON.parse(init.body) as Record<string, unknown>;
    return { ok: true, status: 200, text: async () => JSON.stringify(responseBody) };
  };
  return { http, body: () => captured };
}

describe("OllamaAdapter message mapping", () => {
  it("maps an assistant tool-call message and a tool-result message to the Ollama shape", async () => {
    const { http, body } = stub({ message: { content: "ok" } });
    const adapter = new OllamaAdapter({ model: "m", http });

    await adapter.generate({
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "oc-1", tool: "disk_free", args: { path: "/" } }],
        },
        { role: "tool", content: '{"data":{"freeBytes":1}}', toolCallId: "oc-1" },
      ],
    });

    const msgs = body().messages as Record<string, unknown>[];
    expect((msgs[0].tool_calls as Record<string, unknown>[])[0]).toEqual({
      function: { name: "disk_free", arguments: { path: "/" } },
    });
    expect(msgs[1]).toEqual({ role: "tool", content: '{"data":{"freeBytes":1}}' });
  });
});

describe("OpenAiCompatAdapter argument parsing", () => {
  it("defaults to empty args when tool-call arguments are missing", async () => {
    const { http } = stub({
      choices: [{ message: { tool_calls: [{ id: "c1", function: { name: "t" } }] } }],
    });
    const adapter = new OpenAiCompatAdapter({
      model: "m",
      baseUrl: "https://api.example/v1",
      http,
    });
    const res = await adapter.generate({ messages: [] });
    expect(res.toolCalls[0].args).toEqual({});
  });

  it("defaults to empty args when tool-call arguments are malformed JSON", async () => {
    const { http } = stub({
      choices: [
        { message: { tool_calls: [{ id: "c2", function: { name: "t", arguments: "not json" } }] } },
      ],
    });
    const adapter = new OpenAiCompatAdapter({
      model: "m",
      baseUrl: "https://api.example/v1",
      http,
    });
    const res = await adapter.generate({ messages: [] });
    expect(res.toolCalls[0].args).toEqual({});
  });

  it("synthesizes a positional id when the provider omits the tool-call id", async () => {
    const { http } = stub({
      choices: [{ message: { tool_calls: [{ function: { name: "t", arguments: "{}" } }] } }],
    });
    const adapter = new OpenAiCompatAdapter({
      model: "m",
      baseUrl: "https://api.example/v1",
      http,
    });
    const res = await adapter.generate({ messages: [] });
    expect(res.toolCalls[0].id).toBe("oc-1");
  });

  it("defaults the tool name to empty when the provider omits the function object", async () => {
    const { http } = stub({ choices: [{ message: { tool_calls: [{ id: "c3" }] } }] });
    const adapter = new OpenAiCompatAdapter({
      model: "m",
      baseUrl: "https://api.example/v1",
      http,
    });
    const res = await adapter.generate({ messages: [] });
    expect(res.toolCalls[0]).toEqual({ id: "c3", tool: "", args: {} });
  });
});

describe("defaultHttp", () => {
  it("delegates to the platform fetch", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      status: 200,
      text: async () => "pong",
    })) as unknown as typeof fetch;
    try {
      const res = await defaultHttp("http://example.test", {
        method: "GET",
        headers: {},
        body: "",
      });
      expect(res.ok).toBe(true);
      expect(await res.text()).toBe("pong");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("forwards an AbortSignal to the platform fetch when present", async () => {
    const original = globalThis.fetch;
    let seenSignal: AbortSignal | undefined;
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seenSignal = init.signal ?? undefined;
      return { ok: true, status: 200, text: async () => "ok" };
    }) as unknown as typeof fetch;
    const controller = new AbortController();
    try {
      await defaultHttp("http://example.test", {
        method: "GET",
        headers: {},
        body: "",
        signal: controller.signal,
      });
      expect(seenSignal).toBe(controller.signal);
    } finally {
      globalThis.fetch = original;
    }
  });
});
