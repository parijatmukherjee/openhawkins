import { describe, it, expect } from "vitest";
import {
  AGENT_LOOP_PHASES,
  PHASE_DEPENDENCIES,
  PHASE_RULES,
} from "../src/manifest.js";

describe("Phase Manifest", () => {
  it("has 6 phases", () => {
    expect(AGENT_LOOP_PHASES).toHaveLength(6);
    expect(AGENT_LOOP_PHASES.map((p) => p.id)).toEqual([
      "research",
      "plan",
      "tasks",
      "execute",
      "validate",
      "present",
    ]);
  });

  it("dependencies form a DAG (no cycles)", () => {
    const visited = new Set<string>();
    const hasCycle = (phaseId: string, path: string[]): boolean => {
      if (path.includes(phaseId)) return true;
      if (visited.has(phaseId)) return false;
      visited.add(phaseId);
      for (const dep of PHASE_DEPENDENCIES[phaseId] ?? []) {
        if (hasCycle(dep, [...path, phaseId])) return true;
      }
      return false;
    };

    for (const phase of AGENT_LOOP_PHASES) {
      expect(hasCycle(phase.id, [])).toBe(false);
    }
  });

  it("rules are defined for plan, execute, and validate", () => {
    expect(PHASE_RULES.plan).toBeDefined();
    expect(PHASE_RULES.execute).toBeDefined();
    expect(PHASE_RULES.validate).toBeDefined();
  });

  it("validate rule requires coverage threshold of 0.99", () => {
    expect(PHASE_RULES.validate.coverageThreshold).toBe(0.99);
  });

  it("validate rule requires all gate checks", () => {
    expect(PHASE_RULES.validate.gateChecks).toEqual([
      "build",
      "lint",
      "format",
      "test",
      "coverage",
    ]);
  });
});
