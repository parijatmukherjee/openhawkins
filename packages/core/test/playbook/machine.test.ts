import { describe, it, expect } from "vitest";
import { step, type GateVerdict } from "../../src/playbook/machine.js";
import { DEFAULT_MANIFEST, type PlaybookManifest } from "../../src/playbook/manifest.js";
import type { PlaybookRunState } from "../../src/playbook/events.js";

const passed: GateVerdict = { status: "passed" };
const failed: GateVerdict = { status: "failed", reason: "red" };
const needsOp: GateVerdict = { status: "needs-operator", reason: "confirm" };
const at = (phase: PlaybookRunState["phase"], replans = 0): PlaybookRunState => ({
  phase,
  replans,
});

describe("playbook machine — step", () => {
  it("a passed gate advances to the sequential next phase", () => {
    expect(step(DEFAULT_MANIFEST, at("Research"), passed)).toEqual({
      next: { phase: "Plan", replans: 0 },
      outcome: "advanced",
    });
    expect(step(DEFAULT_MANIFEST, at("Execute"), passed)).toEqual({
      next: { phase: "Validate", replans: 0 },
      outcome: "advanced",
    });
  });

  it("a passed Validate advances to the terminal Present phase", () => {
    expect(step(DEFAULT_MANIFEST, at("Validate"), passed)).toEqual({
      next: { phase: "Present", replans: 0 },
      outcome: "advanced",
    });
  });

  it("a failed Validate routes to onFail (Plan) and increments replans", () => {
    expect(step(DEFAULT_MANIFEST, at("Validate", 0), failed)).toEqual({
      next: { phase: "Plan", replans: 1 },
      outcome: "replan",
    });
  });

  it("the last replan within budget still routes to onFail (not escalation)", () => {
    // maxReplans is 3; the 3rd failure (replans 2 -> 3) is the last allowed replan.
    // Brackets the budget boundary from below so a `>`->`>=` regression is caught.
    expect(step(DEFAULT_MANIFEST, at("Validate", 2), failed)).toEqual({
      next: { phase: "Plan", replans: 3 },
      outcome: "replan",
    });
  });

  it("exceeding maxReplans escalates instead of looping", () => {
    // maxReplans is 3; the 4th failure (replans 3 -> 4) escalates.
    expect(step(DEFAULT_MANIFEST, at("Validate", 3), failed)).toEqual({
      next: { phase: "Validate", replans: 4 },
      outcome: "escalated",
    });
  });

  it("a needs-operator verdict pauses without moving", () => {
    expect(step(DEFAULT_MANIFEST, at("Research"), needsOp)).toEqual({
      next: { phase: "Research", replans: 0 },
      outcome: "paused",
    });
  });

  it("any verdict at the terminal phase is a no-op", () => {
    expect(step(DEFAULT_MANIFEST, at("Present"), passed)).toEqual({
      next: { phase: "Present", replans: 0 },
      outcome: "noop",
    });
  });

  it("a failed gate with no onFail stays on the same phase", () => {
    const m: PlaybookManifest = {
      phases: [
        { phase: "Validate", gate: "validate" },
        { phase: "Present", gate: "soft" },
      ],
      maxReplans: 3,
    };
    expect(step(m, at("Validate", 0), failed)).toEqual({
      next: { phase: "Validate", replans: 1 },
      outcome: "replan",
    });
  });
});
