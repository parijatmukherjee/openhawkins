import type { ModelMessage, ModelToolCall } from "../models/adapter.js";
import type { ToolCall, ToolResult } from "../tools/tool.js";

/** One model round-trip within a turn (re-prompts each add a record). */
export interface ModelCallRecord {
  /** Snapshot of the messages sent to the model (enables deterministic replay). */
  request: ModelMessage[];
  content: string;
  toolCalls: ModelToolCall[];
}

/** A tool call paired with the registry's validated result. */
export interface ToolCallRecord {
  call: ToolCall;
  result: ToolResult;
}

/**
 * The full, replayable record of one turn. The agent loop (S1.4) owns the
 * model↔tool round-trips and produces this; Eleven (S1.5) decides acceptance and
 * the eval harness (S1.7) asserts over it.
 */
export interface TurnRecord {
  input: string;
  modelCalls: ModelCallRecord[];
  toolCalls: ToolCallRecord[];
  /** Corrections Eleven issued before a final was accepted (proof of enforcement). */
  corrections: string[];
  /** Present only once an answer is accepted. */
  final?: string;
  accepted: boolean;
  /** e.g. "ungrounded" — set by `preferred` mode; surfaced to the audit. */
  flagged?: string;
  /** Correlation ID generated per turn, propagated through model calls, tool calls, and audit entries. */
  traceId?: string;
}

/** What the loop asks the accept policy about a model-produced final answer. */
export interface AcceptContext {
  final: string;
  toolResults: ToolCallRecord[];
}

/** The policy's verdict: accept, or re-prompt with a correction. */
export interface AcceptDecision {
  accept: boolean;
  correction?: string;
  flagged?: string;
  /**
   * When accepting, the cleaned final to record instead of the model's raw output
   * (e.g. Eleven returns the human-readable `text` of a structured cited answer).
   */
  final?: string;
}

/**
 * The seam between the agent loop and grounding. In S1.4 the default policy accepts
 * any final; in S1.5 Eleven implements this to enforce grounding modes. The loop
 * never accepts a model "final" directly — it always asks the policy (spec §6).
 */
export interface AcceptPolicy {
  evaluate(ctx: AcceptContext): AcceptDecision;
}
