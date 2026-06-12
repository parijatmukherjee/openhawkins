import { describe, it, expect } from "vitest";
import { ProcessEngine } from "../src/engine.js";
import { AGENT_LOOP_PHASES } from "../src/manifest.js";

describe("Process Enforcement Integration", () => {
  it("runs the full AGENT.md loop end-to-end", async () => {
    const engine = new ProcessEngine();
    engine.state.metadata.planFile = "docs/plans/test.md";

    // Register mock handlers for all 6 phases
    engine.registerPhase("research", async () => ({ logs: ["researched"] }));
    engine.registerPhase("plan", async () => ({ logs: ["planned"] }));
    engine.registerPhase("tasks", async () => ({ logs: ["tasked"] }));
    engine.registerPhase("execute", async () => ({ logs: ["executed"] }));
    engine.registerPhase("validate", async () => ({ logs: ["validated"] }));
    engine.registerPhase("present", async () => ({ logs: ["presented"] }));

    const state = await engine.runAll(AGENT_LOOP_PHASES);

    expect(state.completedPhases).toHaveLength(6);
    expect(state.phaseResults.research.status).toBe("success");
    expect(state.phaseResults.plan.status).toBe("success");
    expect(state.phaseResults.tasks.status).toBe("success");
    expect(state.phaseResults.execute.status).toBe("success");
    expect(state.phaseResults.validate.status).toBe("success");
    expect(state.phaseResults.present.status).toBe("success");
  });

  it("enforces phase dependencies", async () => {
    const engine = new ProcessEngine();
    engine.registerPhase("validate", async () => ({ logs: [] }));

    await expect(engine.runPhase("validate")).rejects.toThrow(
      "Phase validate requires execute to be completed first",
    );
  });

  it("skips already-completed phases on rerun", async () => {
    const engine = new ProcessEngine();
    engine.registerPhase("research", async () => ({ logs: ["done"] }));

    await engine.runPhase("research");
    await engine.runPhase("research");

    expect(engine.state.phaseResults.research.status).toBe("skipped");
    expect(engine.state.completedPhases.filter((p) => p === "research")).toHaveLength(1);
  });
});
