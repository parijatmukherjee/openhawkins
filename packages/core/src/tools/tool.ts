import type { z } from "zod";
import type { Capability } from "../security/capability.js";

/** Minimal execution context handed to a tool handler. Expands in later milestones. */
export interface ToolContext {
  agentId: string;
  /** Correlation ID for the current turn, propagated to logs and audit. */
  traceId?: string;
}

/** A registered tool: typed args/result schemas, required capabilities, a handler. */
export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  args: z.ZodType<TArgs>;
  result: z.ZodType<TResult>;
  capabilities: Capability[];
  handler: (args: TArgs, ctx: ToolContext) => Promise<TResult>;
}

/** A request to run a tool (e.g. emitted by a model's native tool call). */
export interface ToolCall {
  id: string;
  tool: string;
  args: unknown;
}

/** The structured outcome of a tool invocation. The registry never throws. */
export interface ToolResult {
  id: string;
  tool: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}
