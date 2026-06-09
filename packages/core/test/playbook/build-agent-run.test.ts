import { describe, it, expect } from "vitest";
import { buildAgentRun } from "../../src/playbook/build-agent-run.js";
import { AgentRun } from "../../src/playbook/agent-run.js";
import { ScriptedOperator } from "../../src/playbook/operators.js";
import { weakHostFactsModel } from "../../src/eval/scenarios.js";
import { ValidateGate } from "../../src/playbook/gates.js";
import { tmpdir } from "node:os";

const approve = () =>
  new ScriptedOperator([
    { approve: true, actor: "op", reason: "r" },
    { approve: true, actor: "op", reason: "p" },
    { approve: true, actor: "op", reason: "t" },
    { approve: true, actor: "op", reason: "e" },
  ]);

describe("buildAgentRun", () => {
  it("runs a real Agent inside the Execute phase and completes the process", async () => {
    const { run, audit, agent, store } = await buildAgentRun({
      adapter: weakHostFactsModel(tmpdir()),
      grounding: "cited",
      prompts: { Execute: "How much disk space is free on this machine?" },
      operator: approve(),
      validateGate: new ValidateGate(async () => ({ ok: true })), // fake gate (no recursion)
    });
    const result = await run.run();
    expect(result).toEqual({ kind: "completed" });

    const auditKinds = (await audit.entries()).map((e) => e.kind);
    expect(auditKinds).toContain("ToolReturned");
    expect(auditKinds).toContain("FinalAccepted");
    expect(auditKinds).toContain("PhaseEntered");
    expect(auditKinds).toContain("PhaseGatePassed");
    expect(await audit.verify()).toBe(true);

    expect(agent).toBeDefined();
    expect((await store.read("probe-agent-session")).length).toBeGreaterThan(0);
  });

  it("defaults Validate to the real repo gate without running it (construction only)", async () => {
    // Omit validateGate -> the `?? new ValidateGate(gateCommandPredicate(DEFAULT_GATE_COMMANDS))`
    // default is built. Do NOT call run() — that would spawn the real repo gate recursively.
    const built = await buildAgentRun({
      adapter: weakHostFactsModel(tmpdir()),
      grounding: "cited",
      prompts: {},
      operator: approve(),
    });
    expect(built.run).toBeInstanceOf(AgentRun);
  });
});
