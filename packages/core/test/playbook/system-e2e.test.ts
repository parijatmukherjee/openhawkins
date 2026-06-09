import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { buildAgentRun } from "../../src/playbook/build-agent-run.js";
import { ScriptedOperator } from "../../src/playbook/operators.js";
import { weakHostFactsModel } from "../../src/eval/scenarios.js";
import { ValidateGate, type PhaseGate } from "../../src/playbook/gates.js";
import { isPhaseEvent, foldPlaybook, type PhaseEvent } from "../../src/playbook/events.js";
import { InMemoryEventStore } from "../../src/session/events.js";
import type { GenerateRequest, GenerateResult, ModelAdapter } from "../../src/models/adapter.js";

const PROMPT = "How much disk space is free on this machine?";

const approvals = (n: number) =>
  new ScriptedOperator(
    Array.from({ length: n }, () => ({ approve: true as const, actor: "op", reason: "ok" })),
  );

/**
 * The scripted `weakHostFactsModel` carries exactly one 3-step turn (hallucinate ->
 * tool-call -> cited answer). A replan re-enters Execute and so re-runs `agent.ask`,
 * which needs ANOTHER full turn — so a single instance is exhausted on the second
 * Execute. This delegates each fresh turn to a new `weakHostFactsModel`, supplying as
 * many independent weak-model turns as the replan loop requires. Each delegate's step 3
 * reads the tool result out of the request messages, so turns stay stateless and the
 * cited path is preserved verbatim.
 */
function multiTurnWeakModel(path: string, turns: number): ModelAdapter {
  const delegates = Array.from({ length: turns }, () => weakHostFactsModel(path));
  let i = 0;
  return {
    name: "weak-host-facts-multiturn",
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      for (;;) {
        const current = delegates[i];
        if (current === undefined) {
          throw new Error("multiTurnWeakModel: turns exhausted");
        }
        try {
          return await current.generate(req);
        } catch (err) {
          // Only an exhausted delegate (it finished its 3-step turn) means "advance to the
          // next turn"; any other error is a real failure and must surface, not be masked.
          if (!(err instanceof Error && /exhausted/.test(err.message))) {
            throw err;
          }
          i += 1;
        }
      }
    },
  };
}

async function build(validateGate: PhaseGate, approvalCount = 8, turns = 1) {
  return buildAgentRun({
    adapter: multiTurnWeakModel(tmpdir(), turns),
    grounding: "cited",
    prompts: { Execute: PROMPT },
    operator: approvals(approvalCount),
    validateGate,
  });
}

const phaseSeq = async (store: InMemoryEventStore): Promise<string[]> =>
  (await store.read("probe-agent-session")).filter(isPhaseEvent).map((e) => `${e.type}:${e.phase}`);

describe("system end-to-end robustness", () => {
  it("a complete run: real agent turn inside Execute, full audited + replayable trace", async () => {
    const built = await build(new ValidateGate(async () => ({ ok: true })));
    expect(await built.run.run()).toEqual({ kind: "completed" });

    const events = await built.store.read("probe-agent-session");
    const phaseEvents = events.filter(isPhaseEvent) as PhaseEvent[];
    // the process reached Present, and the folded state agrees with the log (replay)
    expect(foldPlaybook(phaseEvents).phase).toBe("Present");
    // the agent's grounded turn is in the SAME unified, tamper-evident chain
    const kinds = (await built.audit.entries()).map((e) => e.kind);
    expect(kinds).toContain("ToolReturned");
    expect(kinds).toContain("FinalAccepted");
    expect(kinds).toContain("PhaseEntered");
    expect(await built.audit.verify()).toBe(true);
  });

  it("replans through a flaky Validate, then completes", async () => {
    let n = 0;
    const flaky: PhaseGate = {
      evaluate: async () =>
        n++ === 0 ? { status: "failed", reason: "red" } : { status: "passed" },
    };
    // One Validate failure re-enters Execute a second time, so the agent needs 2 weak-model
    // turns; the replan also re-pauses Plan/Tasks/Execute, hence the wider approval budget.
    const built = await build(flaky, 12, 2);
    expect(await built.run.run()).toEqual({ kind: "completed" });
    const kinds = (await built.audit.entries()).map((e) => e.kind);
    expect(kinds).toContain("PhaseGateFailed");
    expect(await built.audit.verify()).toBe(true);
  });

  it("escalates when Validate never passes within budget", async () => {
    // maxReplans=3: Execute runs once initially then on each of 3 replans = 4 weak-model
    // turns; each replan re-pauses the soft phases (Plan/Tasks/Execute), so the approval
    // budget must cover all those re-pauses too — 20 is comfortably above the floor.
    const built = await build(
      new ValidateGate(async () => ({ ok: false, detail: "perma-red" })),
      20,
      4,
    );
    const result = await built.run.run();
    expect(result.kind).toBe("escalated");
    expect(await built.audit.verify()).toBe(true);
  });

  it("produces one unified, verifiable audit chain over the whole run", async () => {
    // The agent's grounded turn AND every phase transition share ONE hash-chained log,
    // so a single verify() proves the entire run is intact end-to-end. (The flip-an-entry
    // -> verify()===false proof lives in security/audit.test.ts, which owns the chain.)
    const built = await build(new ValidateGate(async () => ({ ok: true })));
    await built.run.run();
    const entries = await built.audit.entries();
    expect(entries.length).toBeGreaterThan(6); // agent steps + all phase transitions
    expect(entries.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["FinalAccepted", "PhaseEntered"]),
    );
    expect(await built.audit.verify()).toBe(true);
  });

  it("replays deterministically: same scripted inputs -> identical phase-event trace", async () => {
    const a = await build(new ValidateGate(async () => ({ ok: true })));
    const b = await build(new ValidateGate(async () => ({ ok: true })));
    await a.run.run();
    await b.run.run();
    expect(await phaseSeq(a.store as InMemoryEventStore)).toEqual(
      await phaseSeq(b.store as InMemoryEventStore),
    );
  });

  it("a secret planted in a prompt never lands in the event store or audit (F-C3)", async () => {
    // built (not a literal) so the source has no contiguous secret token for scanners
    const SECRET = `sk-${"planted".repeat(3)}`;
    const built = await buildAgentRun({
      adapter: multiTurnWeakModel(tmpdir(), 1),
      grounding: "cited",
      prompts: { Execute: `remember my key ${SECRET}` },
      operator: approvals(8),
      validateGate: new ValidateGate(async () => ({ ok: true })),
    });
    expect(await built.run.run()).toEqual({ kind: "completed" });
    const events = JSON.stringify(await built.store.read("probe-agent-session"));
    const audit = JSON.stringify(await built.audit.entries());
    expect(events).not.toContain(SECRET);
    expect(audit).not.toContain(SECRET);
  });
});
