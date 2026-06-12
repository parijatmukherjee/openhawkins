import { describe, it, expect, vi } from "vitest";
import { runCli, createCliEngine } from "../src/cli.js";
import { ProcessEngine } from "../src/engine.js";
import { AGENT_LOOP_PHASES } from "../src/manifest.js";

describe("CLI", () => {
  it("parses --phase and --plan args", async () => {
    await expect(runCli(["--phase=research", "--plan=docs/plans/test.md"])).rejects.toThrow(
      "No handler for phase research",
    );
  });

  it("parses --phase without --plan", async () => {
    await expect(runCli(["--phase=research"])).rejects.toThrow("No handler");
  });

  it("parses --plan without --phase", async () => {
    await expect(runCli(["--plan=docs/plans/test.md"])).rejects.toThrow("No handler");
  });

  it("runs without args", async () => {
    await expect(runCli([])).rejects.toThrow("No handler");
  });

  it("createCliEngine sets metadata.planFile when --plan is provided", () => {
    const engine = createCliEngine(["--plan=docs/plans/test.md"]);
    expect(engine.state.metadata.planFile).toBe("docs/plans/test.md");
  });

  it("createCliEngine does not set metadata.planFile when --plan is absent", () => {
    const engine = createCliEngine([]);
    expect(engine.state.metadata.planFile).toBeUndefined();
  });

  it("runCli with phase calls runPhase via injected factory", async () => {
    const mockEngine = new ProcessEngine();
    mockEngine.registerPhase("research", async () => ({ logs: [] }));
    const runPhaseSpy = vi.spyOn(mockEngine, "runPhase");
    const runAllSpy = vi.spyOn(mockEngine, "runAll");

    await runCli(["--phase=research"], () => mockEngine);
    expect(runPhaseSpy).toHaveBeenCalledWith("research");
    expect(runAllSpy).not.toHaveBeenCalled();
  });

  it("runCli without phase calls runAll via injected factory", async () => {
    const mockEngine = new ProcessEngine();
    for (const phase of AGENT_LOOP_PHASES) {
      mockEngine.registerPhase(phase.id, async () => ({ logs: [] }));
    }
    const runAllSpy = vi.spyOn(mockEngine, "runAll");

    await runCli([], () => mockEngine);
    expect(runAllSpy).toHaveBeenCalledWith(AGENT_LOOP_PHASES);
  });
});
