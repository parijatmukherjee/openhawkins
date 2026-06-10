import type { GateVerdict } from "./machine.js";
import type { Phase } from "./manifest.js";
import { type Logger, noopLogger } from "../observability/logger.js";

/** What a gate is given to decide a phase. Minimal in P1/P2; the P3 runner enriches it. */
export interface GateContext {
  phase: Phase;
}

/** A phase gate — the Eleven-style accept-or-correct policy for one phase. */
export interface PhaseGate {
  evaluate(ctx: GateContext): Promise<GateVerdict>;
}

/**
 * A soft phase has no machine-checkable completion (Research, Plan, …), so it always
 * pauses for a capability-gated operator decision (the override is handled by the P3
 * runner). The model can never self-certify a soft phase complete.
 */
export class SoftGate implements PhaseGate {
  async evaluate(ctx: GateContext): Promise<GateVerdict> {
    return {
      status: "needs-operator",
      reason: `phase "${ctx.phase}" needs an operator to confirm completion`,
    };
  }
}

/** The result of a validate check: green, or red with optional human-readable detail. */
export interface GateCheck {
  ok: boolean;
  detail?: string;
}

/** An async check the `ValidateGate` runs — injected so it is testable with a fake; the
 *  real default is the repo-gate command predicate in `gate-command.ts`. */
export type ValidatePredicate = () => Promise<GateCheck>;

/**
 * Runs an injected predicate to decide the Validate phase: ok → `passed`; not ok →
 * `failed` (with the predicate's detail). Guaranteed not to throw — a predicate that
 * throws is caught and becomes a `failed` verdict, so a broken gate cannot crash the run.
 */
export class ValidateGate implements PhaseGate {
  constructor(
    private readonly check: ValidatePredicate,
    private readonly logger: Logger = noopLogger,
  ) {}

  async evaluate(): Promise<GateVerdict> {
    try {
      const result = await this.check();
      return result.ok
        ? { status: "passed" }
        : { status: "failed", reason: result.detail ?? "validation failed" };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.log("warn", "gate_predicate_threw", { reason });
      return { status: "failed", reason };
    }
  }
}
