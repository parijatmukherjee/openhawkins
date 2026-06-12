import { describe, it, expect, vi } from "vitest";
import { HookRegistry, installDefaultHooks } from "../src/hooks.js";
import { ProcessEngine } from "../src/engine.js";
import { ProcessError } from "../src/engine.js";

describe("Lifecycle Hooks", () => {
  it("runs pre-phase hooks before phase execution", async () => {
    const registry = new HookRegistry();
    const preHandler = vi.fn();
    registry.register({ type: "pre-phase", phase: "research", handler: preHandler });

    const engine = new ProcessEngine();
    engine.state.currentPhase = "research";
    await registry.run("pre-phase", engine.state);
    expect(preHandler).toHaveBeenCalledWith(engine.state);
  });

  it("runs post-phase hooks after success", async () => {
    const registry = new HookRegistry();
    const postHandler = vi.fn();
    registry.register({ type: "post-phase", phase: "research", handler: postHandler });

    const engine = new ProcessEngine();
    engine.state.currentPhase = "research";
    await registry.run("post-phase", engine.state);
    expect(postHandler).toHaveBeenCalledWith(engine.state);
  });

  it("runs on-failure hooks on error", async () => {
    const registry = new HookRegistry();
    const failureHandler = vi.fn();
    registry.register({
      type: "on-failure",
      phase: "research",
      handler: failureHandler,
    });

    const engine = new ProcessEngine();
    engine.state.currentPhase = "research";
    await registry.run("on-failure", engine.state);
    expect(failureHandler).toHaveBeenCalledWith(engine.state);
  });

  it("runs on-complete hooks", async () => {
    const registry = new HookRegistry();
    const completeHandler = vi.fn();
    registry.register({
      type: "on-complete",
      phase: "research",
      handler: completeHandler,
    });

    const engine = new ProcessEngine();
    engine.state.currentPhase = "research";
    await registry.run("on-complete", engine.state);
    expect(completeHandler).toHaveBeenCalledWith(engine.state);
  });

  it("runs hooks without phase filter for all phases", async () => {
    const registry = new HookRegistry();
    const globalHandler = vi.fn();
    registry.register({ type: "pre-phase", handler: globalHandler });

    const engine = new ProcessEngine();
    engine.state.currentPhase = "execute";
    await registry.run("pre-phase", engine.state);
    expect(globalHandler).toHaveBeenCalledWith(engine.state);
  });

  it("does not run hooks for wrong phase", async () => {
    const registry = new HookRegistry();
    const phaseHandler = vi.fn();
    registry.register({ type: "pre-phase", phase: "research", handler: phaseHandler });

    const engine = new ProcessEngine();
    engine.state.currentPhase = "execute";
    await registry.run("pre-phase", engine.state);
    expect(phaseHandler).not.toHaveBeenCalled();
  });

  it("installs default hooks that validate execute requires plan file", async () => {
    const registry = new HookRegistry();
    installDefaultHooks(registry);

    const engine = new ProcessEngine();
    engine.state.currentPhase = "execute";
    await expect(registry.run("pre-phase", engine.state)).rejects.toThrow(ProcessError);
  });

  it("installs default hooks that allow execute when plan file is set", async () => {
    const registry = new HookRegistry();
    installDefaultHooks(registry);

    const engine = new ProcessEngine({ metadata: { planFile: "docs/plans/test.md" } });
    engine.state.currentPhase = "execute";
    await expect(registry.run("pre-phase", engine.state)).resolves.toBeUndefined();
  });

  it("triggers default post-phase validate hook", async () => {
    const registry = new HookRegistry();
    installDefaultHooks(registry);

    const engine = new ProcessEngine();
    engine.state.currentPhase = "validate";
    await expect(registry.run("post-phase", engine.state)).resolves.toBeUndefined();
  });
});
