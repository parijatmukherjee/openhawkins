import type { ModelAdapter, ModelMessage, ToolSchema } from "../models/adapter.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { ToolDefinition, ToolCall, ToolContext } from "../tools/tool.js";
import type { AgentGrant } from "../security/capability.js";
import { toJsonSchema } from "../tools/to-json-schema.js";
import type { AcceptPolicy, AcceptContext, TurnRecord } from "./turn.js";

// Tools are heterogeneous in their <A,R> type parameters; the loop only reads
// name/description/args, so it stores them with erased type variables (same
// reasoning as ToolRegistry's internal storage).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDefinition = ToolDefinition<any, any>;

/** Accept any final answer — the S1.4 default, before Eleven (S1.5) takes over. */
export const acceptAlways: AcceptPolicy = {
  evaluate: () => ({ accept: true }),
};

export interface AgentLoopConfig {
  adapter: ModelAdapter;
  registry: ToolRegistry;
  grant: AgentGrant;
  /** Tools exposed to the model this turn (their schemas become native functions). */
  tools: AnyToolDefinition[];
  /** Grounding policy; defaults to accept-always until Eleven is wired in. */
  policy?: AcceptPolicy;
  systemPrompt?: string;
  /** Hard ceiling on model round-trips; on exceed the turn ends ungrounded. */
  maxModelCalls?: number;
}

/**
 * The turn state machine (spec §6.2). It runs the native tool-calling round-trip —
 * generate → validate+run tool calls through the capability-gated registry → feed
 * results back → repeat — and asks the accept policy before ever returning a final.
 * It is deterministic given a deterministic adapter, which is what makes replay and
 * the eval harness possible.
 */
export async function runAgentTurn(cfg: AgentLoopConfig, input: string): Promise<TurnRecord> {
  const policy = cfg.policy ?? acceptAlways;
  const maxModelCalls = cfg.maxModelCalls ?? 6;
  const ctx: ToolContext = { agentId: cfg.grant.agentId };

  const toolSchemas: ToolSchema[] = cfg.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: toJsonSchema(t.args),
  }));

  const messages: ModelMessage[] = [];
  if (cfg.systemPrompt) {
    messages.push({ role: "system", content: cfg.systemPrompt });
  }
  messages.push({ role: "user", content: input });

  const record: TurnRecord = {
    input,
    modelCalls: [],
    toolCalls: [],
    corrections: [],
    accepted: false,
  };

  while (record.modelCalls.length < maxModelCalls) {
    const out = await cfg.adapter.generate({ messages, tools: toolSchemas });
    record.modelCalls.push({
      request: messages.map((m) => ({ ...m })),
      content: out.content,
      toolCalls: out.toolCalls,
    });

    if (out.toolCalls.length > 0) {
      // Record the assistant's tool-call message, then run each call through the
      // registry (capability-gated, arg/result validated) and feed results back.
      messages.push({ role: "assistant", content: out.content, toolCalls: out.toolCalls });
      for (const tc of out.toolCalls) {
        const call: ToolCall = { id: tc.id, tool: tc.tool, args: tc.args };
        const result = await cfg.registry.invoke(call, cfg.grant, ctx);
        record.toolCalls.push({ call, result });
        messages.push({ role: "tool", content: JSON.stringify(result), toolCallId: tc.id });
      }
      continue;
    }

    // No tool calls: the model produced a final. The runtime — not the model —
    // decides whether to accept it.
    const acceptCtx: AcceptContext = { final: out.content, toolResults: record.toolCalls };
    const decision = policy.evaluate(acceptCtx);
    if (decision.accept) {
      record.final = out.content;
      record.accepted = true;
      if (decision.flagged) {
        record.flagged = decision.flagged;
      }
      return record;
    }

    const correction = decision.correction ?? "Reconsider your answer.";
    record.corrections.push(correction);
    messages.push({ role: "user", content: correction });
  }

  // Budget exhausted without an accepted answer — a grounded failure, not a guess.
  return record;
}
