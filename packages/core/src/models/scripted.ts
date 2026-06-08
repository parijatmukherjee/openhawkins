import type { ModelAdapter, GenerateRequest, GenerateResult } from "./adapter.js";

/**
 * A step is either a fixed result or a function of the request. The function form
 * lets a script react to the running conversation — e.g. read the real tool result
 * out of the messages and cite its actual value — which is exactly what the
 * deterministic hallucination test needs (real tool output, scripted "model").
 */
export type ScriptedStep = GenerateResult | ((req: GenerateRequest) => GenerateResult);

/**
 * A deterministic `ModelAdapter` that returns pre-scripted steps in order. This is
 * the spec's replay/eval mechanism (§7.2): the loop logic is exercised against
 * recorded model outputs so runs are reproducible despite real models being
 * non-deterministic. Used by unit tests and the eval harness.
 */
export class ScriptedAdapter implements ModelAdapter {
  readonly name: string;
  private readonly steps: ScriptedStep[];
  private cursor = 0;

  constructor(steps: ScriptedStep[], name = "scripted") {
    this.steps = steps;
    this.name = name;
  }

  /** How many times the loop has called the model — handy for assertions. */
  get calls(): number {
    return this.cursor;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const step = this.steps[this.cursor];
    if (step === undefined) {
      throw new Error(`scripted model exhausted after ${this.cursor} step(s)`);
    }
    this.cursor += 1;
    return typeof step === "function" ? step(req) : step;
  }
}
