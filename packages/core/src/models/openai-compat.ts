import type {
  ModelAdapter,
  ModelMessage,
  GenerateRequest,
  GenerateResult,
  ModelToolCall,
} from "./adapter.js";
import {
  defaultHttp,
  parseJsonOrThrow,
  assertSafeBaseUrl,
  requestWithTimeout,
  withRetry,
  type HttpFetch,
} from "./http.js";

/**
 * OpenAI-compatible adapter — the `/v1/chat/completions` wire format spoken by
 * Groq, OpenRouter, llama.cpp/LM Studio servers, and many free tiers, so one
 * adapter unlocks several providers (spec §12.1). `baseUrl` selects the provider;
 * the key is resolved from the Vault by the caller.
 */
export interface OpenAiCompatConfig {
  model: string;
  /** e.g. `https://api.groq.com/openai/v1` or a local server's `/v1`. */
  baseUrl: string;
  apiKey?: string;
  http?: HttpFetch;
  /** Per-request deadline in ms before the call is aborted (default 30000). */
  timeoutMs?: number;
  /** Bounded retries on a transient failure (default 2). */
  retries?: number;
  /** Base backoff in ms for the exponential retry (default 200). */
  retryBaseMs?: number;
}

interface OpenAiToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface OpenAiChatResponse {
  choices?: { message?: { content?: string | null; tool_calls?: OpenAiToolCall[] } }[];
}

export class OpenAiCompatAdapter implements ModelAdapter {
  readonly name = "openai-compat";
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly http: HttpFetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseMs: number;

  constructor(cfg: OpenAiCompatConfig) {
    this.model = cfg.model;
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    assertSafeBaseUrl(this.baseUrl);
    this.apiKey = cfg.apiKey;
    this.http = cfg.http ?? defaultHttp;
    this.timeoutMs = cfg.timeoutMs ?? 30000;
    this.retries = cfg.retries ?? 2;
    this.retryBaseMs = cfg.retryBaseMs ?? 200;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: req.messages.map(toOpenAiMessage),
    };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = "auto";
    }
    if (req.responseSchema) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "response", schema: req.responseSchema },
      };
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const url = `${this.baseUrl}/chat/completions`;
    const res = await withRetry(
      () =>
        requestWithTimeout(
          this.http,
          url,
          { method: "POST", headers, body: JSON.stringify(body) },
          this.timeoutMs,
        ),
      { retries: this.retries, baseDelayMs: this.retryBaseMs },
    );
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`openai-compat request failed (${res.status}): ${text}`);
    }
    return parseOpenAiResponse(
      parseJsonOrThrow<OpenAiChatResponse>(text, "openai-compat", res.status),
    );
  }
}

function toOpenAiMessage(m: ModelMessage): Record<string, unknown> {
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: m.content,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.tool, arguments: JSON.stringify(tc.args) },
      })),
    };
  }
  if (m.role === "tool") {
    return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  }
  return { role: m.role, content: m.content };
}

function parseOpenAiResponse(json: OpenAiChatResponse): GenerateResult {
  const message = json.choices?.[0]?.message;
  const toolCalls: ModelToolCall[] = (message?.tool_calls ?? []).map((tc, i) => ({
    id: tc.id ?? `oc-${i + 1}`,
    tool: tc.function?.name ?? "",
    args: parseArgs(tc.function?.arguments),
  }));
  return { content: message?.content ?? "", toolCalls };
}

// OpenAI sends tool arguments as a JSON string; tolerate malformed/empty payloads
// by falling back to an empty object so the registry's arg validation (not a parse
// crash) is what rejects a bad call.
function parseArgs(raw: string | undefined): unknown {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
