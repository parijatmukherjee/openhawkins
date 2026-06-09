# Playbook P2 — Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Playbook phase gates — the Eleven-style accept-or-correct policies that produce a `GateVerdict` for a phase: `SoftGate` (always pauses for an operator) and `ValidateGate` (runs an injected predicate; green→passed, red/throw→failed, never throws), plus the real repo-gate predicate that spawns the gate command.

**Architecture:** Two new files in `packages/core/src/playbook/`. `gates.ts` holds the pure gate layer: the `GateContext` + `PhaseGate` interface, `SoftGate`, and `ValidateGate` over an injected `ValidatePredicate` (unit-tested with fakes — no real IO). `gate-command.ts` holds the one IO piece: `runCommand` (a promisified `node:child_process` spawn → `{ ok, detail }`) and `gateCommandPredicate(commands)` that runs a list of commands in sequence, failing on the first non-zero exit — the production predicate the P3 runner wires into a `ValidateGate`. Gates produce the `GateVerdict` already defined in `machine.ts` (P1).

**Tech Stack:** TypeScript (strict: `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`, `useUnknownInCatchVariables`), ESM with `.js` import specifiers, Vitest, Node 24 + Bun 1.3. Prettier printWidth 100, double quotes. `node:child_process` is available on both Node and Bun.

**Spec:** [`docs/specs/2026-06-09-playbook-process-engine-design.md`](../specs/2026-06-09-playbook-process-engine-design.md) — milestone **P2** (§3.4, §8).

**Depends on (already merged, P1):** `packages/core/src/playbook/machine.ts` exports `type GateVerdict = { status: "passed" } | { status: "failed"; reason: string } | { status: "needs-operator"; reason: string }`. `manifest.ts` exports `type Phase`.

**Conventions to follow (read before starting):**

- Tests live at `packages/core/test/playbook/<name>.test.ts` and import source as `../../src/playbook/<name>.js`.
- Every cross-file import uses a `.js` specifier even though the files are `.ts`.
- The coverage gate is **≥99% across all metrics**; each new file must be 100%. Earn it with real behavior tests, never by gaming.
- `ValidateGate.evaluate` must **never throw** — a throwing predicate becomes a `failed` verdict (mirrors the registry/Eleven never-throw discipline).
- For deterministic, cross-platform child-process tests, spawn `process.execPath` (the running Node/Bun binary, always present) with `["-e", "<tiny script>"]` — never assume `node`/`npm` are on `PATH` in a unit test.

---

### Task 1: `PhaseGate` interface + `SoftGate`

**Files:**

- Create: `packages/core/src/playbook/gates.ts`
- Test: `packages/core/test/playbook/gates.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/playbook/gates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SoftGate, type PhaseGate, type GateContext } from "../../src/playbook/gates.js";

describe("SoftGate", () => {
  it("always returns needs-operator, naming the phase", async () => {
    const gate: PhaseGate = new SoftGate();
    const ctx: GateContext = { phase: "Research" };
    const verdict = await gate.evaluate(ctx);
    expect(verdict.status).toBe("needs-operator");
    if (verdict.status === "needs-operator") {
      expect(verdict.reason).toContain("Research");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/gates.test.ts`
Expected: FAIL — cannot find module `../../src/playbook/gates.js`.

- [ ] **Step 3: Write `packages/core/src/playbook/gates.ts`**

```ts
import type { GateVerdict } from "./machine.js";
import type { Phase } from "./manifest.js";

/** What a gate is given to decide a phase. Minimal in P1/P2; the P3 runner enriches it. */
export interface GateContext {
  phase: Phase;
}

/** A phase gate — the Eleven-style accept-or-correct policy for one phase. */
export interface PhaseGate {
  evaluate(ctx: GateContext): Promise<GateVerdict>;
}

/**
 * A soft phase has no machine-checkable completion (Research, Plan, …), so it always
 * pauses for a capability-gated operator decision (the override is handled by the P3
 * runner). The model can never self-certify a soft phase complete.
 */
export class SoftGate implements PhaseGate {
  async evaluate(ctx: GateContext): Promise<GateVerdict> {
    return {
      status: "needs-operator",
      reason: `phase "${ctx.phase}" needs an operator to confirm completion`,
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/playbook/gates.test.ts --coverage.enabled --coverage.include='packages/core/src/playbook/gates.ts'`
Expected: PASS (1 test). `gates.ts` 100% (ValidateGate is added in Task 2; coverage is measured per-task here, so 100% of what exists).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/playbook/gates.ts packages/core/test/playbook/gates.test.ts
git commit -m "feat(playbook): PhaseGate interface + SoftGate"
```

---

### Task 2: `ValidateGate` over an injected predicate

**Files:**

- Modify: `packages/core/src/playbook/gates.ts` (add `GateCheck`, `ValidatePredicate`, `ValidateGate`)
- Modify: `packages/core/test/playbook/gates.test.ts` (add a `ValidateGate` describe block)

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/playbook/gates.test.ts` (add `ValidateGate` to the existing import from `gates.js`):

```ts
import { ValidateGate, type ValidatePredicate } from "../../src/playbook/gates.js";

describe("ValidateGate", () => {
  const ctx: GateContext = { phase: "Validate" };

  it("passes when the predicate reports ok", async () => {
    const gate = new ValidateGate(async () => ({ ok: true }));
    expect(await gate.evaluate(ctx)).toEqual({ status: "passed" });
  });

  it("fails with the predicate's detail when it reports not ok", async () => {
    const gate = new ValidateGate(async () => ({ ok: false, detail: "coverage 98%" }));
    expect(await gate.evaluate(ctx)).toEqual({ status: "failed", reason: "coverage 98%" });
  });

  it("fails with a default reason when not ok and no detail is given", async () => {
    const gate = new ValidateGate(async () => ({ ok: false }));
    expect(await gate.evaluate(ctx)).toEqual({ status: "failed", reason: "validation failed" });
  });

  it("never throws: a throwing predicate becomes a failed verdict", async () => {
    const boom: ValidatePredicate = async () => {
      throw new Error("gate command crashed");
    };
    const gate = new ValidateGate(boom);
    expect(await gate.evaluate(ctx)).toEqual({
      status: "failed",
      reason: "gate command crashed",
    });
  });

  it("stringifies a non-Error thrown by the predicate", async () => {
    const gate = new ValidateGate(async () => {
      throw "weird";
    });
    expect(await gate.evaluate(ctx)).toEqual({ status: "failed", reason: "weird" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/gates.test.ts`
Expected: FAIL — `ValidateGate` / `ValidatePredicate` are not exported.

- [ ] **Step 3: Add to `packages/core/src/playbook/gates.ts`**

Append these exports to the existing file (after `SoftGate`):

```ts
/** The result of a validate check: green, or red with optional human-readable detail. */
export interface GateCheck {
  ok: boolean;
  detail?: string;
}

/** An async check the `ValidateGate` runs — injected so it is testable with a fake and
 *  real by default (the repo-gate command predicate from `gate-command.ts`). */
export type ValidatePredicate = () => Promise<GateCheck>;

/**
 * Runs an injected predicate to decide the Validate phase: ok → `passed`; not ok →
 * `failed` (with the predicate's detail). Guaranteed not to throw — a predicate that
 * throws is caught and becomes a `failed` verdict, so a broken gate cannot crash the run.
 */
export class ValidateGate implements PhaseGate {
  constructor(private readonly check: ValidatePredicate) {}

  async evaluate(_ctx: GateContext): Promise<GateVerdict> {
    try {
      const result = await this.check();
      return result.ok
        ? { status: "passed" }
        : { status: "failed", reason: result.detail ?? "validation failed" };
    } catch (err) {
      return { status: "failed", reason: err instanceof Error ? err.message : String(err) };
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/playbook/gates.test.ts --coverage.enabled --coverage.include='packages/core/src/playbook/gates.ts'`
Expected: PASS (6 tests total); `gates.ts` 100% across stmts/branch/funcs/lines (both `ok` branches, the `?? "validation failed"` branch, and the Error/non-Error catch arms are covered by the five ValidateGate tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/playbook/gates.ts packages/core/test/playbook/gates.test.ts
git commit -m "feat(playbook): ValidateGate over an injected predicate (never-throws)"
```

---

### Task 3: The real repo-gate command predicate

**Files:**

- Create: `packages/core/src/playbook/gate-command.ts`
- Test: `packages/core/test/playbook/gate-command.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/playbook/gate-command.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  runCommand,
  gateCommandPredicate,
  DEFAULT_GATE_COMMANDS,
} from "../../src/playbook/gate-command.js";

// Spawn the running JS engine itself (always present on Node + Bun) so these tests are
// deterministic and cross-platform — no dependency on `node`/`npm` being on PATH.
const SELF = process.execPath;
const exit = (code: number): [string, string[]] => [SELF, ["-e", `process.exit(${code})`]];

describe("runCommand", () => {
  it("reports ok for a zero exit code", async () => {
    const [cmd, args] = exit(0);
    expect(await runCommand(cmd, args)).toEqual({ ok: true });
  });

  it("reports not ok with detail for a non-zero exit code", async () => {
    const [cmd, args] = exit(3);
    const result = await runCommand(cmd, args);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("exit code 3");
  });

  it("includes captured stderr in the detail on failure", async () => {
    const result = await runCommand(SELF, ["-e", 'console.error("boom-detail"); process.exit(1)']);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("boom-detail");
  });

  it("reports not ok when the binary cannot be spawned", async () => {
    const result = await runCommand("definitely-not-a-real-binary-xyz", []);
    expect(result.ok).toBe(false);
    expect(result.detail).toBeDefined();
  });
});

describe("gateCommandPredicate", () => {
  it("passes when every command exits zero", async () => {
    const predicate = gateCommandPredicate([
      [SELF, ["-e", "process.exit(0)"]],
      [SELF, ["-e", "process.exit(0)"]],
    ]);
    expect(await predicate()).toEqual({ ok: true });
  });

  it("fails on the first non-zero command and reports which one", async () => {
    const predicate = gateCommandPredicate([
      [SELF, ["-e", "process.exit(0)"]],
      [SELF, ["-e", 'console.error("step-2-failed"); process.exit(1)']],
      [SELF, ["-e", "process.exit(0)"]],
    ]);
    const result = await predicate();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("step-2-failed");
  });

  it("exposes the default gate commands as npm scripts", () => {
    const scripts = DEFAULT_GATE_COMMANDS.map(([, args]) => args[args.length - 1]);
    expect(scripts).toEqual(["build", "lint", "format:check", "coverage", "test:functional"]);
    expect(DEFAULT_GATE_COMMANDS.every(([cmd]) => cmd === "npm")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/gate-command.test.ts`
Expected: FAIL — cannot find module `../../src/playbook/gate-command.js`.

- [ ] **Step 3: Write `packages/core/src/playbook/gate-command.ts`**

```ts
import { spawn } from "node:child_process";
import type { GateCheck, ValidatePredicate } from "./gates.js";

/** A command to run: the executable and its argument list (no shell — args are literal). */
export type Command = [cmd: string, args: string[]];

/**
 * Run one command to completion, capturing output. Resolves `{ ok: true }` on a zero
 * exit, or `{ ok: false, detail }` on a non-zero exit or a spawn error (e.g. the binary
 * is missing). Never rejects — failures are returned as data, not thrown.
 */
export function runCommand(cmd: string, args: string[]): Promise<GateCheck> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", (err) => {
      resolve({ ok: false, detail: `failed to run ${cmd}: ${err.message}` });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true });
      } else {
        const tail = out.trim();
        const detail = `${cmd} ${args.join(" ")} exited with exit code ${code ?? "null"}`;
        resolve({ ok: false, detail: tail.length > 0 ? `${detail}\n${tail}` : detail });
      }
    });
  });
}

/** The repo gate as a command list (run in order; the Docker gate runs the same set). */
export const DEFAULT_GATE_COMMANDS: Command[] = [
  ["npm", ["run", "build"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "format:check"]],
  ["npm", ["run", "coverage"]],
  ["npm", ["run", "test:functional"]],
];

/**
 * Build a `ValidatePredicate` that runs `commands` in order and fails on the first
 * non-zero exit (short-circuit), surfacing that command's detail. Pass
 * `DEFAULT_GATE_COMMANDS` for the real repo gate.
 */
export function gateCommandPredicate(commands: Command[]): ValidatePredicate {
  return async () => {
    for (const [cmd, args] of commands) {
      const result = await runCommand(cmd, args);
      if (!result.ok) {
        return result;
      }
    }
    return { ok: true };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/playbook/gate-command.test.ts --coverage.enabled --coverage.include='packages/core/src/playbook/gate-command.ts'`
Expected: PASS (7 tests); `gate-command.ts` 100% (the zero/non-zero close arms, the `error` arm via the missing-binary test, the `code ?? "null"` and `tail.length > 0` branches, and the predicate's short-circuit-vs-all-pass branches are all covered).

> If v8 flags the `code ?? "null"` nullish branch (it is hard to force a `null` exit code without signals), it is acceptable for this single defensive coalesce to be the one uncovered branch **only if** `gate-command.ts` still reports ≥99% and the aggregate gate stays green. Prefer covering it; if you cannot, leave the `?? "null"` in (it is correct defensive code) and report the exact per-file number.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/playbook/gate-command.ts packages/core/test/playbook/gate-command.test.ts
git commit -m "feat(playbook): repo-gate command predicate (spawn-based, never-rejects)"
```

---

### Task 4: Barrel exports + the full gate

**Files:**

- Modify: `packages/core/src/playbook/index.ts` (re-export the two new files)
- Test: `packages/core/test/playbook/index.test.ts` (extend the existing barrel assertion)

- [ ] **Step 1: Write the failing test**

In `packages/core/test/playbook/index.test.ts`, add these assertions inside the existing `it("re-exports …")` test body (keep the existing P1 assertions):

```ts
expect(typeof playbook.SoftGate).toBe("function");
expect(typeof playbook.ValidateGate).toBe("function");
expect(typeof playbook.runCommand).toBe("function");
expect(typeof playbook.gateCommandPredicate).toBe("function");
expect(Array.isArray(playbook.DEFAULT_GATE_COMMANDS)).toBe(true);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/playbook/index.test.ts`
Expected: FAIL — `playbook.SoftGate` etc. are `undefined` (not yet re-exported).

- [ ] **Step 3: Extend the barrel**

`packages/core/src/playbook/index.ts` becomes:

```ts
export * from "./manifest.js";
export * from "./events.js";
export * from "./machine.js";
export * from "./gates.js";
export * from "./gate-command.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/playbook/index.test.ts`
Expected: PASS (1 test, extended).

- [ ] **Step 5: Run the FULL repo gate**

Run: `npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional`
Expected: all green; aggregate coverage ≥99% across all metrics, with every `packages/core/src/playbook/*.ts` at 100%. If `format:check` complains, run `npm run format` first. Paste the coverage table tail (the `All files` line + the `playbook/` rows). If any pre-existing untouched file is below threshold, STOP and report — do not modify unrelated files.

- [ ] **Step 6: Run the Docker gate (the required PR check)**

Run: `docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test`
Expected: ends with `✅ ALL GATES PASSED`. If docker is unavailable, report that explicitly — do not silently skip.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/playbook/index.ts packages/core/test/playbook/index.test.ts
git commit -m "feat(playbook): export gates; P2 complete"
```

---

## Self-Review (coverage of the spec — P2 portion)

- **Spec §3.4 — `PhaseGate` interface + `GateVerdict`:** `gates.ts` `PhaseGate`/`GateContext` (Task 1), producing the P1 `GateVerdict`. ✓
- **Spec §3.4 — `SoftGate` returns `needs-operator`:** Task 1. ✓
- **Spec §3.4 — `ValidateGate` over an injected predicate; default runs the repo gate; a throwing predicate is caught → `failed`:** `ValidateGate` (Task 2) + `gateCommandPredicate`/`DEFAULT_GATE_COMMANDS` (Task 3). ✓
- **Spec §6 — testing (fake predicate for pass/fail/throw; a real command predicate; behavior-level; ≥99%):** Task 2 fakes + Task 3 spawns `process.execPath`; full gate + Docker in Task 4. ✓
- **Deferred to P3 (not this plan):** wiring a gate per `PhaseSpec.gate` kind; the `PlaybookRun` runner; the operator-override + `playbook:override` capability + Murray audit; mapping `Transition.outcome` → emitted events. The `GateContext` stays minimal here and is enriched by the runner.
- **Type consistency:** `GateContext`, `PhaseGate`, `SoftGate`, `GateCheck`, `ValidatePredicate`, `ValidateGate`, `Command`, `runCommand`, `gateCommandPredicate`, `DEFAULT_GATE_COMMANDS` — names used identically across Tasks 1–4 and the tests; `GateVerdict`/`Phase` reused from P1 unchanged. ✓

---

## Next plan (after P2 lands)

- **P3** — `runner.ts`: the `PlaybookRun` single-writer driver that, per `PhaseSpec.gate`, evaluates the matching gate, maps each `step` outcome → emitted `PhaseEvent`s + Murray audit, enforces the new `playbook:override` `CapabilityName` (The Lab) with denied-override auditing, and drives the replan-budget/escalation flow. Full event-sequence + audit-chain tests.
