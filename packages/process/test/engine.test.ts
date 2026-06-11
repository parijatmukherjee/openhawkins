import { describe, it, expect } from "vitest";
import { ProcessEngine, ProcessError } from "../src/engine.js";
import { AGENT_LOOP_PHASES, PHASE_DEPENDENCIES } from "../src/manifest.js";

describe("ProcessEngine", () => {
  it("runs all 6 phases in order", async () => {
    const engine = new ProcessEngine();
    const logs: string[] = [];

    for (const phase of AGENT_LOOP_PHASES) {
      engine.registerPhase(phase.id, async () => {
        logs.push(phase.id);
        return { logs: [phase.id] };
      });
    }

    const state = await engine.runAll(AGENT_LOOP_PHASES);
    expect(state.completedPhases).toHaveLength(6);
    expect(logs).toEqual(["research", "plan", "tasks", "execute", "validate", "present"]);
  });

  it("skips already-completed phases", async () => {
    const engine = new ProcessEngine();
    engine.registerPhase("research", async () => ({ logs: ["done"] }));

    await engine.runPhase("research");
    await engine.runPhase("research"); // second run should skip

    expect(engine.state.phaseResults.research.status).toBe("skipped");
    expect(engine.state.completedPhases).toEqual(["research"]);
  });

  it("fails on missing dependency", async () => {
    const engine = new ProcessEngine();
    engine.registerPhase("validate", async () => ({ logs: [] }));

    await expect(engine.runPhase("validate")).rejects.toThrow(ProcessError);
  });

  it("tracks phase results", async () => {
    const engine = new ProcessEngine();
    engine.registerPhase("research", async () => ({ logs: ["found specs"] }));

    await engine.runPhase("research");
    expect(engine.state.phaseResults.research.status).toBe("success");
    expect(engine.state.phaseResults.research.logs).toEqual(["found specs"]);
  });

  it("emits failure status on error", async () => {
    const engine = new ProcessEngine();
    engine.registerPhase("research", async () => {
      throw new Error("boom");
    });

    await expect(engine.runPhase("research")).rejects.toThrow("boom");
    expect(engine.state.phaseResults.research.status).toBe("failure");
  });
});
