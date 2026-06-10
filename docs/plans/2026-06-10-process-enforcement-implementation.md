# Process Enforcement Implementation Plan — AGENT.md Loop as Playbook

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Runtime-enforce the AGENT.md operating loop (Research → Plan → Tasks → Execute → Validate → Present) using the Playbook process engine.

**Design spec:** `docs/adr/0002-process-enforcement-native-not-n8n.md`

---

## Architecture

```
packages/process/
  src/
    manifest.ts        # Phase manifest for the AGENT.md loop
    engine.ts          # ProcessEngine: runs the loop, emits events
    gate.ts            # Per-phase gate checks (coverage, tests, etc.)
    hooks.ts           # Lifecycle hooks (pre-phase, post-phase, on-failure)
    index.ts
  test/
    engine.test.ts
    gate.test.ts
    integration.test.ts
```

---

## Task 1: Phase Manifest for AGENT.md Loop

**Files:**

- `packages/process/src/manifest.ts`

- [ ] **Step 1: Define 6 phases**

```typescript
export const AGENT_LOOP_PHASES = [
  {
    id: "research",
    name: "Research",
    description: "Explore codebase, read specs, understand context",
  },
  { id: "plan", name: "Plan", description: "Write implementation plan with tasks and checkpoints" },
  { id: "tasks", name: "Tasks", description: "Create todo list from plan, mark in_progress" },
  { id: "execute", name: "Execute", description: "Write code (TDD), commit per logical change" },
  {
    id: "validate",
    name: "Validate",
    description: "Run the gate: build, lint, format, test, coverage",
  },
  { id: "present", name: "Present", description: "Create PR with description, link to plan" },
] as const;
```

- [ ] **Step 2: Phase dependencies**

```typescript
export const PHASE_DEPENDENCIES: Record<string, string[]> = {
  research: [],
  plan: ["research"],
  tasks: ["plan"],
  execute: ["tasks"],
  validate: ["execute"],
  present: ["validate"],
};
```

- [ ] **Step 3: Phase validation rules**

```typescript
export interface PhaseRule {
  requiredFiles?: string[]; // e.g., plan must exist before execute
  minTests?: number; // execute phase needs ≥1 test
  coverageThreshold?: number; // validate needs ≥99%
  gateChecks?: string[]; // validate runs build + lint + format + test
}

export const PHASE_RULES: Record<string, PhaseRule> = {
  plan: { requiredFiles: ["docs/plans/*.md"] },
  execute: { minTests: 1 },
  validate: {
    coverageThreshold: 0.99,
    gateChecks: ["build", "lint", "format", "test", "coverage"],
  },
};
```

- [ ] **Step 4: Tests**
  - Phase manifest is complete (6 phases)
  - Dependencies form a DAG (no cycles)
  - Rules are defined for plan/execute/validate

- [ ] **Step 5: Commit**

```bash
git add packages/process/src/manifest.ts
git commit -m "feat(process): AGENT.md loop phase manifest with dependencies and validation rules"
```

---

## Task 2: Process Engine

**Files:**

- `packages/process/src/engine.ts`

- [ ] **Step 1: ProcessState interface**

```typescript
export interface ProcessState {
  currentPhase: string;
  completedPhases: string[];
  phaseResults: Record<string, { status: "success" | "failure" | "skipped"; logs: string[] }>;
  startTime: number;
  metadata: Record<string, unknown>;
}
```

- [ ] **Step 2: ProcessEngine class**

```typescript
export class ProcessEngine {
  private state: ProcessState;
  private phaseHandlers: Map<string, PhaseHandler> = new Map();

  registerPhase(phaseId: string, handler: PhaseHandler): void {
    this.phaseHandlers.set(phaseId, handler);
  }

  async runPhase(phaseId: string): Promise<void> {
    // Check dependencies
    const deps = PHASE_DEPENDENCIES[phaseId];
    for (const dep of deps) {
      if (!this.state.completedPhases.includes(dep)) {
        throw new ProcessError(`Phase ${phaseId} requires ${dep} to be completed first`);
      }
    }

    // Run handler
    this.state.currentPhase = phaseId;
    const handler = this.phaseHandlers.get(phaseId);
    if (!handler) throw new ProcessError(`No handler for phase ${phaseId}`);

    try {
      const result = await handler(this.state);
      this.state.completedPhases.push(phaseId);
      this.state.phaseResults[phaseId] = { status: "success", logs: result.logs };
    } catch (err) {
      this.state.phaseResults[phaseId] = { status: "failure", logs: [String(err)] };
      throw err;
    }
  }

  async runAll(): Promise<ProcessState> {
    for (const phase of AGENT_LOOP_PHASES) {
      await this.runPhase(phase.id);
    }
    return this.state;
  }
}
```

- [ ] **Step 3: PhaseHandler type**

```typescript
export type PhaseHandler = (state: ProcessState) => Promise<{ logs: string[] }>;
```

- [ ] **Step 4: Tests**
  - Run all 6 phases in order
  - Skip already-completed phases
  - Fail on missing dependency
  - Emit state events

- [ ] **Step 5: Commit**

```bash
git add packages/process/src/engine.ts
git commit -m "feat(process): ProcessEngine with phase registration, dependency checks, and state tracking"
```

---

## Task 3: Per-Phase Gate Checks

**Files:**

- `packages/process/src/gate.ts`

- [ ] **Step 1: Gate runner**

```typescript
export async function runGate(checks: string[]): Promise<{ passed: boolean; failures: string[] }> {
  const failures: string[] = [];
  for (const check of checks) {
    switch (check) {
      case "build":
        if (!(await checkBuild())) failures.push("build failed");
        break;
      case "lint":
        if (!(await checkLint())) failures.push("lint failed");
        break;
      case "format":
        if (!(await checkFormat())) failures.push("format:check failed");
        break;
      case "test":
        if (!(await checkTests())) failures.push("tests failed");
        break;
      case "coverage":
        if (!(await checkCoverage(0.99))) failures.push("coverage < 99%");
        break;
    }
  }
  return { passed: failures.length === 0, failures };
}
```

- [ ] **Step 2: Individual checks**

```typescript
async function checkBuild(): Promise<boolean> {
  try {
    execSync("npm run build", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Phase-specific gate**

```typescript
export async function validatePhase(state: ProcessState): Promise<{ logs: string[] }> {
  const rules = PHASE_RULES.validate;
  if (!rules) return { logs: ["no validation rules"] };

  const { passed, failures } = await runGate(rules.gateChecks ?? []);
  if (!passed) throw new ProcessError(`Gate failed: ${failures.join(", ")}`);

  return { logs: ["all gates passed"] };
}
```

- [ ] **Step 4: Tests**
  - Mock gate checks
  - Pass/fail scenarios
  - Coverage threshold enforcement

- [ ] **Step 5: Commit**

```bash
git add packages/process/src/gate.ts
git commit -m "feat(process): per-phase gate checks with build/lint/format/test/coverage runners"
```

---

## Task 4: Lifecycle Hooks

**Files:**

- `packages/process/src/hooks.ts`

- [ ] **Step 1: Hook types**

```typescript
export type HookType = "pre-phase" | "post-phase" | "on-failure" | "on-complete";

export interface LifecycleHook {
  type: HookType;
  phase?: string; // optional: run for specific phase only
  handler: (state: ProcessState) => Promise<void> | void;
}
```

- [ ] **Step 2: Hook registry**

```typescript
export class HookRegistry {
  private hooks: LifecycleHook[] = [];

  register(hook: LifecycleHook): void {
    this.hooks.push(hook);
  }

  async run(type: HookType, state: ProcessState): Promise<void> {
    const matching = this.hooks.filter(
      (h) => h.type === type && (h.phase === undefined || h.phase === state.currentPhase),
    );
    for (const hook of matching) {
      await hook.handler(state);
    }
  }
}
```

- [ ] **Step 3: Default hooks**

```typescript
export function installDefaultHooks(registry: HookRegistry): void {
  // Pre-execute: verify plan exists
  registry.register({
    type: "pre-phase",
    phase: "execute",
    handler: (state) => {
      if (!state.metadata.planFile) {
        throw new ProcessError("Cannot execute without a plan file");
      }
    },
  });

  // Post-validate: log coverage
  registry.register({
    type: "post-phase",
    phase: "validate",
    handler: () => console.log("✅ Validation passed"),
  });
}
```

- [ ] **Step 4: Tests**
  - Pre-phase hook runs before phase
  - Post-phase hook runs after success
  - On-failure hook runs on error

- [ ] **Step 5: Commit**

```bash
git add packages/process/src/hooks.ts
git commit -m "feat(process): lifecycle hooks with pre-phase, post-phase, and on-failure handlers"
```

---

## Task 5: Event Emission + Replay

**Files:**

- `packages/process/src/events.ts`

- [ ] **Step 1: ProcessEvent interface**

```typescript
export interface ProcessEvent {
  id: string;
  type: "phase-started" | "phase-completed" | "phase-failed" | "gate-passed" | "gate-failed";
  phaseId: string;
  timestamp: number;
  data?: unknown;
}
```

- [ ] **Step 2: Event emitter**

```typescript
export class ProcessEventBus {
  private listeners: Map<string, ((event: ProcessEvent) => void)[]> = new Map();

  on(type: string, handler: (event: ProcessEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
  }

  emit(event: ProcessEvent): void {
    const list = this.listeners.get(event.type) ?? [];
    for (const handler of list) handler(event);
  }
}
```

- [ ] **Step 3: Tests**
  - Emit + listen
  - Multiple listeners
  - Replay from event log

- [ ] **Step 4: Commit**

```bash
git add packages/process/src/events.ts
git commit -m "feat(process): event bus for phase lifecycle events with replay support"
```

---

## Task 6: CLI Integration

**Files:**

- `packages/process/src/cli.ts`

- [ ] **Step 1: CLI command**

```typescript
// npx process-run --phase=validate --plan=docs/plans/foo.md
export async function runCli(args: string[]): Promise<void> {
  const phase = args.find((a) => a.startsWith("--phase="))?.split("=")[1];
  const plan = args.find((a) => a.startsWith("--plan="))?.split("=")[1];

  const engine = new ProcessEngine();
  if (plan) engine.state.metadata.planFile = plan;

  if (phase) {
    await engine.runPhase(phase);
  } else {
    await engine.runAll();
  }
}
```

- [ ] **Step 2: Tests**
  - Run single phase
  - Run all phases
  - Error on missing plan

- [ ] **Step 3: Commit**

```bash
git add packages/process/src/cli.ts
git commit -m "feat(process): CLI for running single phase or full AGENT.md loop"
```

---

## Task 7: Integration Test

**Files:**

- `packages/process/test/integration.test.ts`

- [ ] **Step 1: Full loop test**

```typescript
it("runs the full AGENT.md loop end-to-end", async () => {
  const engine = new ProcessEngine();
  engine.state.metadata.planFile = "docs/plans/test.md";

  // Register mock handlers
  engine.registerPhase("research", async () => ({ logs: ["researched"] }));
  engine.registerPhase("plan", async () => ({ logs: ["planned"] }));
  engine.registerPhase("tasks", async () => ({ logs: ["tasked"] }));
  engine.registerPhase("execute", async () => ({ logs: ["executed"] }));
  engine.registerPhase("validate", validatePhase);
  engine.registerPhase("present", async () => ({ logs: ["presented"] }));

  const state = await engine.runAll();

  expect(state.completedPhases).toHaveLength(6);
  expect(state.phaseResults.validate.status).toBe("success");
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/process/test/
git commit -m "test(process): integration test for full AGENT.md loop execution"
```

---

## Task 8: Export Barrel + Package Config

**Files:**

- `packages/process/src/index.ts`
- `packages/process/package.json`
- `packages/process/tsconfig.json`

- [ ] **Step 1: Export barrel**

```typescript
export * from "./manifest.js";
export * from "./engine.js";
export * from "./gate.js";
export * from "./hooks.js";
export * from "./events.js";
```

- [ ] **Step 2: Package config**

```json
{
  "name": "@openjarvis/process",
  "version": "0.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "dependencies": {
    "@openjarvis/core": "*",
    "@openjarvis/playbook": "*"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/process/
git commit -m "feat(process): export barrel + package config"
```

---

## Task 9: Final Gate

- [ ] **Step 1: Build**
- [ ] **Step 2: Lint**
- [ ] **Step 3: Format**
- [ ] **Step 4: Tests (coverage ≥99%)**
- [ ] **Step 5: Docker gate**

---

## Plan Self-Review

**1. Spec coverage:**

- ✅ All 6 AGENT.md phases represented
- ✅ Dependencies enforced (DAG)
- ✅ Per-phase gate checks (validate runs the full gate)
- ✅ Lifecycle hooks (pre/post/failure)
- ✅ Event emission for observability
- ✅ CLI for manual invocation

**2. Scope:**

- This is a medium plan (9 tasks). Consider 2 PRs:
  - PR 1: Tasks 1–5 (manifest + engine + gate + hooks + events)
  - PR 2: Tasks 6–9 (CLI + integration + export + gate)

**3. Gate compliance:**

- ✅ TDD for every task
- ✅ Build verification at each step
