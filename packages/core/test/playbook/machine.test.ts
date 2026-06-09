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
      phase: "Plan",
      outcome: "advanced",
    });
    expect(step(DEFAULT_MANIFEST, at("Execute"), passed)).toEqual({
      phase: "Validate",
      outcome: "advanced",
    });
  });

  it("a passed Validate advances to the terminal Present phase", () => {
    expect(step(DEFAULT_MANIFEST, at("Validate"), passed)).toEqual({
      phase: "Present",
      outcome: "advanced",
    });
  });

  it("a failed Validate routes to onFail (Plan); the fold owns the count", () => {
    expect(step(DEFAULT_MANIFEST, at("Validate", 0), failed)).toEqual({
      phase: "Plan",
      outcome: "replan",
    });
  });

  it("the last replan within budget still routes to onFail (not escalation)", () => {
    // maxReplans is 3; at replans 2 the budget is not yet spent (2 >= 3 is false), so this
    // is still a replan. Brackets the budget boundary from below so a `>=`->`>` regression
    // (which would escalate one failure too late) is caught.
    expect(step(DEFAULT_MANIFEST, at("Validate", 2), failed)).toEqual({
      phase: "Plan",
      outcome: "replan",
    });
  });

  it("exceeding maxReplans escalates instead of looping", () => {
    // maxReplans is 3; at replans 3 the budget is spent (3 >= 3), so the next failure
    // escalates and stays on Validate.
    expect(step(DEFAULT_MANIFEST, at("Validate", 3), failed)).toEqual({
      phase: "Validate",
      outcome: "escalated",
    });
  });

  it("a needs-operator verdict pauses without moving", () => {
    expect(step(DEFAULT_MANIFEST, at("Research"), needsOp)).toEqual({
      phase: "Research",
      outcome: "paused",
    });
  });

  it("any verdict at the terminal phase is a no-op", () => {
    expect(step(DEFAULT_MANIFEST, at("Present"), passed)).toEqual({
      phase: "Present",
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
      phase: "Validate",
      outcome: "replan",
    });
  });
});
