import type { AcceptPolicy, AcceptContext, AcceptDecision } from "../loop/turn.js";
import { toJsonSchema } from "../tools/to-json-schema.js";
import { citedAnswerSchema, parseAnswer, verifyCitations } from "./citations.js";

/**
 * Eleven — the grounding engine (spec §6). It sits between the model and the
 * acceptance of a final answer: the agent loop never accepts a "final" directly, it
 * asks Eleven. The model proposes; Eleven enforces. This is the structural fix for
 * P1 (hallucination): a weak model cannot shortcut grounding because the runtime —
 * not the model — owns the accept decision, and checks tool calls and citations.
 */
export type GroundingMode =
  | "off" // free chat; no enforcement (the negative control)
  | "preferred" // accept ungrounded answers but flag them
  | "required" // MUST have >=1 successful qualifying tool call before a final
  | "cited"; // required + the final must cite tool-result ids (strongest)

export interface ElevenConfig {
  mode: GroundingMode;
  /** Tool names that count as grounding. Undefined = any successful tool call. */
  qualifyingTools?: string[];
}

export class Eleven implements AcceptPolicy {
  private readonly mode: GroundingMode;
  private readonly qualifyingTools: string[] | undefined;

  constructor(cfg: ElevenConfig) {
    this.mode = cfg.mode;
    this.qualifyingTools = cfg.qualifyingTools;
  }

  evaluate(ctx: AcceptContext): AcceptDecision {
    switch (this.mode) {
      case "off":
        return { accept: true };
      case "preferred":
        return this.hasQualifyingCall(ctx)
          ? { accept: true }
          : { accept: true, flagged: "ungrounded" };
      case "required":
        return this.evaluateRequired(ctx);
      case "cited":
        return this.evaluateCited(ctx);
    }
  }

  private hasQualifyingCall(ctx: AcceptContext): boolean {
    return ctx.toolResults.some(
      (r) =>
        r.result.ok &&
        (this.qualifyingTools === undefined || this.qualifyingTools.includes(r.result.tool)),
    );
  }

  private requireToolCorrection(): string {
    const names = this.qualifyingTools?.join(", ") ?? "the required tool";
    return (
      `You must successfully call ${names} before answering. Do not guess. ` +
      `If you genuinely cannot, respond ONLY with {"unknown": true, "reason": "..."}.`
    );
  }

  private evaluateRequired(ctx: AcceptContext): AcceptDecision {
    if (parseAnswer(ctx.final).kind === "unknown") {
      return { accept: true, flagged: "unknown" };
    }
    if (!this.hasQualifyingCall(ctx)) {
      return { accept: false, correction: this.requireToolCorrection() };
    }
    return { accept: true };
  }

  private evaluateCited(ctx: AcceptContext): AcceptDecision {
    const parsed = parseAnswer(ctx.final);
    if (parsed.kind === "unknown") {
      return { accept: true, flagged: "unknown" };
    }
    // Required-tool gate applies before we even look at citations.
    if (!this.hasQualifyingCall(ctx)) {
      return { accept: false, correction: this.requireToolCorrection() };
    }
    if (parsed.kind === "invalid") {
      return {
        accept: false,
        correction:
          'Respond ONLY as JSON: {"text": "...", "claims": [{"statement": "...", ' +
          '"citesToolResultId": "<a tool-result id>", "value": <number, optional>}]}.',
      };
    }
    if (parsed.answer.claims.length === 0) {
      return {
        accept: false,
        correction:
          "Your answer must cite at least one tool result. Add a claim with its tool-result id.",
      };
    }
    const issues = verifyCitations(parsed.answer, ctx.toolResults);
    if (issues.length > 0) {
      const detail = issues.map((i) => `- "${i.statement}": ${i.detail}`).join("\n");
      return {
        accept: false,
        correction: `These claims are not supported by tool results:\n${detail}\nFix the citations or the values.`,
      };
    }
    return { accept: true, final: parsed.answer.text };
  }
}

/** The JSON Schema for a cited answer, for adapters that support structured output. */
export function citedAnswerJsonSchema(): Record<string, unknown> {
  return toJsonSchema(citedAnswerSchema);
}

/**
 * A system-prompt fragment that tells the model how to satisfy the given mode. The
 * runtime still enforces regardless of the prompt — this just helps the model
 * comply on the first try (spec §6.4: make the grounded path the easy one).
 */
export function groundingInstruction(mode: GroundingMode, qualifyingTools?: string[]): string {
  const names = qualifyingTools?.join(", ") ?? "the available tools";
  switch (mode) {
    case "off":
      return "";
    case "preferred":
      return `Prefer calling ${names} to verify facts before answering.`;
    case "required":
      return (
        `You MUST call ${names} and use the result before answering. Do not guess. ` +
        `If you cannot, reply ONLY with {"unknown": true, "reason": "..."}.`
      );
    case "cited":
      return (
        `You MUST call ${names} first, then answer ONLY as JSON: ` +
        `{"text": "...", "claims": [{"statement": "...", ` +
        `"citesToolResultId": "<tool-result id>", "value": <number, optional>, "field": "<dot-notation path, optional>"}]}. ` +
        `"field" is the exact path in the tool result where the number came from ` +
        `(e.g. "freeBytes" or "data.freeBytes"). ` +
        `Every factual claim must cite the tool-result id it came from. Do not guess; ` +
        `if you cannot ground the answer, reply ONLY with {"unknown": true, "reason": "..."}.`
      );
  }
}
