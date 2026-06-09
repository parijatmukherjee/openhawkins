import type { EventStore } from "../session/events.js";
import type { AuditLog } from "../security/audit.js";
import { grantSatisfies, type AgentGrant } from "../security/capability.js";
import { type Clock, systemClock } from "../util/clock.js";
import { type PlaybookManifest, type Phase, phaseSpec, nextPhase } from "./manifest.js";
import { type PlaybookRunState, type PhaseEvent, reducePlaybook } from "./events.js";
import { step } from "./machine.js";
import type { PhaseGate } from "./gates.js";

/** Everything a run needs: the manifest, the session/run ids, the VINES store + Murray
 *  audit it writes to, the operator's capability grant, and the two gates it dispatches to. */
export interface PlaybookRunDeps {
  manifest: PlaybookManifest;
  sessionId: string;
  runId: string;
  store: EventStore;
  audit: AuditLog;
  grant: AgentGrant;
  softGate: PhaseGate;
  validateGate: PhaseGate;
  clock?: Clock;
}

/** The externally observable state of a run after an operation. */
export type RunStatus =
  | { kind: "running"; phase: Phase }
  | { kind: "awaiting-operator"; phase: Phase; reason: string }
  | { kind: "escalated"; phase: Phase; reason: string }
  | { kind: "done"; phase: Phase };

const OVERRIDE_CAPABILITY = "playbook:override" as const;

/**
 * The single-writer driver for one Playbook run. It evaluates each phase's gate, applies
 * the pure `step` transition, and commits the resulting `PhaseEvent`s to VINES + Murray
 * (so the run replays and is tamper-evident). Soft phases pause for a capability-gated,
 * audited operator `override`. Methods are awaited in order; one run = one writer.
 */
export class PlaybookRun {
  private _state: PlaybookRunState;
  private _status: RunStatus;

  private constructor(
    private readonly deps: PlaybookRunDeps,
    private readonly clock: Clock,
    startPhase: Phase,
  ) {
    this._state = { phase: startPhase, replans: 0 };
    this._status = { kind: "running", phase: startPhase };
  }

  /** Begin a run: enter the manifest's first phase (one committed + audited event). */
  static async start(deps: PlaybookRunDeps): Promise<PlaybookRun> {
    const first = deps.manifest.phases[0];
    if (first === undefined) {
      throw new Error("PlaybookRun.start: manifest has no phases");
    }
    const run = new PlaybookRun(deps, deps.clock ?? systemClock, first.phase);
    await run.enter(first.phase);
    return run;
  }

  get state(): PlaybookRunState {
    return this._state;
  }

  status(): RunStatus {
    return this._status;
  }

  /** Signal the current phase complete: evaluate its gate and apply the transition. */
  async advance(): Promise<RunStatus> {
    const phase = this._state.phase;
    // An escalated run is paused for an operator (spec §4): re-advancing it would just
    // re-fail the same gate and pile up PhaseGateFailed entries, so it is a no-op until
    // `override` resolves it.
    if (this._status.kind === "escalated") {
      return this._status;
    }
    // Guard the terminal phase here so we never evaluate a gate past `Present`. This also
    // means `step` is only called with a non-terminal phase, so its `noop` outcome (which
    // it returns only at the terminal phase) is unreachable below — hence no `noop` case.
    if (nextPhase(this.deps.manifest, phase) === undefined) {
      this._status = { kind: "done", phase };
      return this._status;
    }
    const spec = phaseSpec(this.deps.manifest, phase);
    const gate = spec.gate === "validate" ? this.deps.validateGate : this.deps.softGate;
    const verdict = await gate.evaluate({ phase });
    const transition = step(this.deps.manifest, this._state, verdict);
    const reason = "reason" in verdict ? verdict.reason : "";
    switch (transition.outcome) {
      case "advanced":
        await this.commit(this.gatePassed(phase));
        await this.enter(transition.phase);
        this._status = this.statusForPhase(transition.phase);
        break;
      case "replan":
        await this.commit(this.gateFailed(phase, reason, false));
        await this.enter(transition.phase);
        this._status = { kind: "running", phase: transition.phase };
        break;
      case "escalated":
        await this.commit(this.gateFailed(phase, reason, true));
        this._status = { kind: "escalated", phase, reason };
        break;
      case "paused":
        this._status = { kind: "awaiting-operator", phase, reason };
        break;
    }
    return this._status;
  }

  /**
   * Operator override of the current phase. Capability-gated (`playbook:override`) and
   * audited either way: a denied attempt records a `PhaseOverrideDenied` audit entry and
   * changes nothing; a granted override commits `PhaseOverridden` then advances as if the
   * gate had passed.
   */
  async override(actor: string, reason: string): Promise<RunStatus> {
    const phase = this._state.phase;
    if (nextPhase(this.deps.manifest, phase) === undefined) {
      this._status = { kind: "done", phase };
      return this._status;
    }
    if (!grantSatisfies(this.deps.grant, { name: OVERRIDE_CAPABILITY })) {
      await this.deps.audit.append({
        kind: "PhaseOverrideDenied",
        data: { phase, actor, reason, sessionId: this.deps.sessionId, runId: this.deps.runId },
        at: this.clock(),
      });
      return this._status;
    }
    await this.commit({
      type: "PhaseOverridden",
      sessionId: this.deps.sessionId,
      runId: this.deps.runId,
      phase,
      actor,
      reason,
      at: this.clock(),
    });
    const transition = step(this.deps.manifest, this._state, { status: "passed" });
    await this.enter(transition.phase);
    this._status = this.statusForPhase(transition.phase);
    return this._status;
  }

  private statusForPhase(phase: Phase): RunStatus {
    return nextPhase(this.deps.manifest, phase) === undefined
      ? { kind: "done", phase }
      : { kind: "running", phase };
  }

  private gatePassed(phase: Phase): PhaseEvent {
    return {
      type: "PhaseGatePassed",
      sessionId: this.deps.sessionId,
      runId: this.deps.runId,
      phase,
      at: this.clock(),
    };
  }

  private gateFailed(phase: Phase, reason: string, escalate: boolean): PhaseEvent {
    return {
      type: "PhaseGateFailed",
      sessionId: this.deps.sessionId,
      runId: this.deps.runId,
      phase,
      reason,
      escalate,
      at: this.clock(),
    };
  }

  private async enter(phase: Phase): Promise<void> {
    await this.commit({
      type: "PhaseEntered",
      sessionId: this.deps.sessionId,
      runId: this.deps.runId,
      phase,
      at: this.clock(),
    });
  }

  /** Append to VINES, mirror to Murray, fold into local state — in that order. */
  private async commit(event: PhaseEvent): Promise<void> {
    await this.deps.store.append(event);
    await this.deps.audit.append({ kind: event.type, data: { ...event }, at: event.at });
    this._state = reducePlaybook(this._state, event);
  }
}
