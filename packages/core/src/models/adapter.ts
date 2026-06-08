/**
 * The model layer's provider-agnostic contract. The agent loop (S1.4) and Eleven
 * (S1.5) talk only to `ModelAdapter` — never to a concrete provider — so the same
 * agent runs unchanged on Ollama (local + cloud) and any OpenAI-compatible endpoint
 * (spec §1.1.2, §5.1). Concrete adapters live in `ollama.ts` / `openai-compat.ts`;
 * `scripted.ts` is the deterministic adapter used for replay and the eval harness.
 */

export type ModelRole = "system" | "user" | "assistant" | "tool";

/** A tool invocation a model asked for (provider tool-call ids are normalized in). */
export interface ModelToolCall {
  id: string;
  tool: string;
  args: unknown;
}

/** One message in the running conversation handed to / returned from a model. */
export interface ModelMessage {
  role: ModelRole;
  content: string;
  /** Present on an assistant message that requested tool calls. */
  toolCalls?: ModelToolCall[];
  /** Present on a `tool` message: the id of the call this result answers. */
  toolCallId?: string;
}

/** A tool exposed to the model as a native function definition (JSON Schema args). */
export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface GenerateRequest {
  messages: ModelMessage[];
  /** Native tool-calling: the tools the model may call this step. */
  tools?: ToolSchema[];
  /** When set, ask the provider to return a JSON object matching this schema. */
  responseSchema?: Record<string, unknown>;
}

/** What a model produced: free text and/or a set of tool calls. */
export interface GenerateResult {
  content: string;
  toolCalls: ModelToolCall[];
}

/** The single contract every provider implements. Stateless per call. */
export interface ModelAdapter {
  readonly name: string;
  generate(req: GenerateRequest): Promise<GenerateResult>;
}
