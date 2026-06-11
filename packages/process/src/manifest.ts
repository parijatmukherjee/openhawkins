export const AGENT_LOOP_PHASES = [
  {
    id: "research",
    name: "Research",
    description: "Explore codebase, read specs, understand context",
  },
  {
    id: "plan",
    name: "Plan",
    description: "Write implementation plan with tasks and checkpoints",
  },
  {
    id: "tasks",
    name: "Tasks",
    description: "Create todo list from plan, mark in_progress",
  },
  {
    id: "execute",
    name: "Execute",
    description: "Write code (TDD), commit per logical change",
  },
  {
    id: "validate",
    name: "Validate",
    description: "Run the gate: build, lint, format, test, coverage",
  },
  {
    id: "present",
    name: "Present",
    description: "Create PR with description, link to plan",
  },
] as const;

export const PHASE_DEPENDENCIES: Record<string, string[]> = {
  research: [],
  plan: ["research"],
  tasks: ["plan"],
  execute: ["tasks"],
  validate: ["execute"],
  present: ["validate"],
};

export interface PhaseRule {
  requiredFiles?: string[];
  minTests?: number;
  coverageThreshold?: number;
  gateChecks?: string[];
}

export const PHASE_RULES: Record<string, PhaseRule> = {
  plan: { requiredFiles: ["docs/plans/*.md"] },
  execute: { minTests: 1 },
  validate: {
    coverageThreshold: 0.99,
    gateChecks: ["build", "lint", "format", "test", "coverage"],
  },
};
