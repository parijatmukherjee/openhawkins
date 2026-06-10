import { describe, it, expect } from "vitest";
import {
  DEFAULT_MANIFEST,
  phaseSpec,
  nextPhase,
  type PlaybookManifest,
} from "../../src/playbook/manifest.js";

describe("playbook manifest", () => {
  it("default manifest is the AGENT.md spine with a Validate->Plan onFail", () => {
    expect(DEFAULT_MANIFEST.phases.map((p) => p.phase)).toEqual([
      "Research",
      "Plan",
      "Tasks",
      "Execute",
      "Validate",
      "Present",
    ]);
    expect(phaseSpec(DEFAULT_MANIFEST, "Validate").gate).toBe("validate");
    expect(phaseSpec(DEFAULT_MANIFEST, "Validate").onFail).toBe("Plan");
    expect(phaseSpec(DEFAULT_MANIFEST, "Research").gate).toBe("soft");
    expect(DEFAULT_MANIFEST.maxReplans).toBe(3);
  });

  it("nextPhase returns the sequential successor, or undefined at the terminal phase", () => {
    expect(nextPhase(DEFAULT_MANIFEST, "Research")).toBe("Plan");
    expect(nextPhase(DEFAULT_MANIFEST, "Execute")).toBe("Validate");
    expect(nextPhase(DEFAULT_MANIFEST, "Validate")).toBe("Present");
    expect(nextPhase(DEFAULT_MANIFEST, "Present")).toBeUndefined();
  });

  it("nextPhase returns undefined when the phase is not in the manifest", () => {
    const tiny: PlaybookManifest = {
      phases: [{ phase: "Research", gate: "soft" }],
      maxReplans: 1,
    };
    expect(nextPhase(tiny, "Validate")).toBeUndefined();
  });

  it("phaseSpec throws for a phase not in the manifest", () => {
    const tiny: PlaybookManifest = {
      phases: [{ phase: "Research", gate: "soft" }],
      maxReplans: 1,
    };
    expect(() => phaseSpec(tiny, "Validate")).toThrow(/not in manifest/);
  });
});
