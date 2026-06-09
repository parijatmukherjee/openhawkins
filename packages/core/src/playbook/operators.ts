import type { Phase } from "./manifest.js";
import type { Operator, OperatorDecision } from "./agent-run.js";

/** A deterministic operator for tests / unattended runs: returns a fixed list of
 *  decisions in order, then declines (a safe default — never silently approves). */
export class ScriptedOperator implements Operator {
  private i = 0;
  constructor(private readonly decisions: OperatorDecision[]) {}

  async review(): Promise<OperatorDecision> {
    return this.decisions[this.i++] ?? { approve: false };
  }
}

/** IO seam so the human operator is testable without a real TTY. */
export interface HumanOperatorIo {
  actor: string;
  /** Read one line of operator input (e.g. from stdin). */
  readLine: () => Promise<string>;
  /** Write a prompt (e.g. to stdout). */
  write: (s: string) => void;
}

/** Prompts a human to approve/decline a paused soft phase. Approves on a line starting
 *  with `y`; anything else declines. */
export class HumanOperator implements Operator {
  constructor(private readonly io: HumanOperatorIo) {}

  async review(req: { phase: Phase; reason: string }): Promise<OperatorDecision> {
    this.io.write(
      `\n[playbook] phase "${req.phase}" needs approval: ${req.reason}\n  approve? [y/N] `,
    );
    const line = (await this.io.readLine()).trim().toLowerCase();
    if (line.startsWith("y")) {
      return { approve: true, actor: this.io.actor, reason: `operator approved ${req.phase}` };
    }
    return { approve: false };
  }
}
