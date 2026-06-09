import { describe, it, expect } from "vitest";
import { OpenAiCompatAdapter } from "../../src/models/openai-compat.js";
import type { HttpFetch } from "../../src/models/http.js";

function stub(
  responseBody: unknown,
  status = 200,
): { http: HttpFetch; body: () => Record<string, unknown> } {
  let captured: Record<string, unknown> = {};
  const http: HttpFetch = async (_url, init) => {
    captured = JSON.parse(init.body) as Record<string, unknown>;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(responseBody),
    };
  };
  return { http, body: () => captured };
}

describe("OpenAiCompatAdapter", () => {
  it("parses a plain text completion from choices[0].message.content", async () => {
    const { http } = stub({ choices: [{ message: { content: "the answer", tool_calls: [] } }] });
    const adapter = new OpenAiCompatAdapter({
      model: "gpt-x",
      baseUrl: "https://api.example/v1",
      http,
    });

    const res = await adapter.generate({ messages: [{ role: "user", content: "q" }] });
    expect(res).toEqual({ content: "the answer", toolCalls: [] });
  });

  it("parses tool_calls and JSON-decodes the string arguments", async () => {
    const { http } = stub({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: { name: "disk_free", arguments: '{"path":"/"}' },
              },
            ],
          },
        },
      ],
    });
    const adapter = new OpenAiCompatAdapter({
      model: "gpt-x",
      baseUrl: "https://api.example/v1",
      http,
    });

    const res = await adapter.generate({ messages: [{ role: "user", content: "disk?" }] });
    expect(res.toolCalls).toEqual([{ id: "call_abc", tool: "disk_free", args: { path: "/" } }]);
    expect(res.content).toBe("");
  });

  it("serializes assistant tool calls and tool results in the OpenAI shape", async () => {
    const { http, body } = stub({ choices: [{ message: { content: "done" } }] });
    const adapter = new OpenAiCompatAdapter({
      model: "gpt-x",
      baseUrl: "https://api.example/v1",
      apiKey: "sk-1",
      http,
    });

    await adapter.generate({
      messages: [
        { role: "user", content: "disk?" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", tool: "disk_free", args: { path: "/" } }],
        },
        { role: "tool", content: '{"freeBytes":42}', toolCallId: "call_1" },
      ],
    });

    const msgs = body().messages as Record<string, unknown>[];
    const assistant = msgs[1];
    expect((assistant.tool_calls as Record<string, unknown>[])[0]).toMatchObject({
      id: "call_1",
      type: "function",
      function: { name: "disk_free", arguments: '{"path":"/"}' },
    });
    expect(msgs[2]).toEqual({ role: "tool", tool_call_id: "call_1", content: '{"freeBytes":42}' });
  });

  it("throws with the server body on a non-2xx response", async () => {
    const { http } = stub({ error: { message: "bad key" } }, 401);
    const adapter = new OpenAiCompatAdapter({
      model: "gpt-x",
      baseUrl: "https://api.example/v1",
      http,
    });
    await expect(adapter.generate({ messages: [] })).rejects.toThrow(
      /openai-compat request failed \(401\)/,
    );
  });

  it("rejects with a diagnosable error when a 200 body is not JSON (HTML error page)", async () => {
    const http: HttpFetch = async () => ({
      ok: true,
      status: 200,
      text: async () => "<html>oops</html>",
    });
    const adapter = new OpenAiCompatAdapter({
      model: "gpt-x",
      baseUrl: "https://api.example/v1",
      http,
    });
    await expect(adapter.generate({ messages: [] })).rejects.toThrow(/non-JSON/);
  });

  it("honors explicit timeout/retry config on the happy path (one attempt, no abort)", async () => {
    const { http } = stub({ choices: [{ message: { content: "ok", tool_calls: [] } }] });
    const adapter = new OpenAiCompatAdapter({
      model: "gpt-x",
      baseUrl: "https://api.example/v1",
      http,
      timeoutMs: 5,
      retries: 1,
      retryBaseMs: 0,
    });
    const res = await adapter.generate({ messages: [{ role: "user", content: "q" }] });
    expect(res.content).toBe("ok");
  });
});
