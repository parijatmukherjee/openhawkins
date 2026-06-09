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
 * Ollama adapter — one code path for both **local** (default
 * `http://127.0.0.1:11434`) and **cloud** (`https://ollama.com`, bearer key). Cloud
 * is just a different `baseUrl` + `apiKey`; nothing else changes (spec §1.1.2). Uses
 * Ollama's `/api/chat` native tool-calling and `format` for structured output.
 */
export interface OllamaConfig {
  model: string;
  /** Defaults to the local daemon. Point at `https://ollama.com` for cloud. */
  baseUrl?: string;
  /** Bearer key for Ollama cloud; resolved from the Vault by the caller. */
  apiKey?: string;
  /** Injected for tests; defaults to the real transport. */
  http?: HttpFetch;
  /** Per-request deadline in ms before the call is aborted (default 30000). */
  timeoutMs?: number;
  /** Bounded retries on a transient failure (default 2). */
  retries?: number;
  /** Base backoff in ms for the exponential retry (default 200). */
  retryBaseMs?: number;
}

interface OllamaToolCall {
  function?: { name?: string; arguments?: unknown };
}
interface OllamaChatResponse {
  message?: { content?: string; tool_calls?: OllamaToolCall[] };
}

export class OllamaAdapter implements ModelAdapter {
  readonly name = "ollama";
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly http: HttpFetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseMs: number;

  constructor(cfg: OllamaConfig) {
    this.model = cfg.model;
    this.baseUrl = (cfg.baseUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");
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
      messages: req.messages.map(toOllamaMessage),
      stream: false,
    };
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (req.responseSchema) {
      body.format = req.responseSchema;
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (this.apiKey) {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const url = `${this.baseUrl}/api/chat`;
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
      throw new Error(`ollama request failed (${res.status}): ${text}`);
    }
    return parseOllamaResponse(parseJsonOrThrow<OllamaChatResponse>(text, "ollama", res.status));
  }
}

function toOllamaMessage(m: ModelMessage): Record<string, unknown> {
  if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: m.content,
      tool_calls: m.toolCalls.map((tc) => ({
        function: { name: tc.tool, arguments: tc.args },
      })),
    };
  }
  // Ollama uses the "tool" role with the result as content; no id is required.
  return { role: m.role, content: m.content };
}

function parseOllamaResponse(json: OllamaChatResponse): GenerateResult {
  const raw = json.message?.tool_calls ?? [];
  // Ollama omits tool-call ids; synthesize stable, positional ids so replay and
  // tool-result correlation are deterministic.
  const toolCalls: ModelToolCall[] = raw.map((tc, i) => ({
    id: `oc-${i + 1}`,
    tool: tc.function?.name ?? "",
    args: tc.function?.arguments ?? {},
  }));
  return { content: json.message?.content ?? "", toolCalls };
}
