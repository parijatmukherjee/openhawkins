import { describe, it, expect } from "vitest";
import {
  isPhaseEvent,
  reducePlaybook,
  foldPlaybook,
  type PhaseEvent,
  type PlaybookRunState,
} from "../../src/playbook/events.js";
import type { Phase } from "../../src/playbook/manifest.js";

const entered = (phase: Phase): PhaseEvent => ({
  type: "PhaseEntered",
  sessionId: "s1",
  runId: "r1",
  phase,
  at: 1,
});

describe("isPhaseEvent", () => {
  it("recognizes the four phase-event types and rejects others", () => {
    expect(isPhaseEvent({ type: "PhaseEntered" })).toBe(true);
    expect(isPhaseEvent({ type: "PhaseGatePassed" })).toBe(true);
    expect(isPhaseEvent({ type: "PhaseGateFailed" })).toBe(true);
    expect(isPhaseEvent({ type: "PhaseOverridden" })).toBe(true);
    expect(isPhaseEvent({ type: "TurnStarted" })).toBe(false);
  });
});

describe("reducePlaybook", () => {
  const start: PlaybookRunState = { phase: "Research", replans: 0 };

  it("PhaseEntered moves to the entered phase", () => {
    expect(reducePlaybook(start, entered("Plan"))).toEqual({ phase: "Plan", replans: 0 });
  });

  it("PhaseGateFailed increments the replan counter without moving", () => {
    const e: PhaseEvent = {
      type: "PhaseGateFailed",
      sessionId: "s1",
      runId: "r1",
      phase: "Validate",
      reason: "red",
      escalate: false,
      at: 2,
    };
    expect(reducePlaybook({ phase: "Validate", replans: 0 }, e)).toEqual({
      phase: "Validate",
      replans: 1,
    });
  });

  it("PhaseGatePassed and PhaseOverridden are records that do not change state", () => {
    const passed: PhaseEvent = {
      type: "PhaseGatePassed",
      sessionId: "s1",
      runId: "r1",
      phase: "Validate",
      at: 3,
    };
    const overridden: PhaseEvent = {
      type: "PhaseOverridden",
      sessionId: "s1",
      runId: "r1",
      phase: "Research",
      actor: "alice",
      reason: "spikes done",
      at: 4,
    };
    expect(reducePlaybook(start, passed)).toEqual(start);
    expect(reducePlaybook(start, overridden)).toEqual(start);
  });
});

describe("foldPlaybook", () => {
  it("replays a clean run to the terminal phase", () => {
    const log: PhaseEvent[] = [
      entered("Research"),
      entered("Plan"),
      entered("Tasks"),
      entered("Execute"),
      entered("Validate"),
      entered("Present"),
    ];
    expect(foldPlaybook(log)).toEqual({ phase: "Present", replans: 0 });
  });

  it("counts replans across a Validate failure loop", () => {
    const fail: PhaseEvent = {
      type: "PhaseGateFailed",
      sessionId: "s1",
      runId: "r1",
      phase: "Validate",
      reason: "red",
      escalate: false,
      at: 9,
    };
    expect(foldPlaybook([entered("Validate"), fail, entered("Plan")])).toEqual({
      phase: "Plan",
      replans: 1,
    });
  });

  it("seeds the start phase from the first PhaseEntered when given no seed", () => {
    expect(foldPlaybook([entered("Research")])).toEqual({ phase: "Research", replans: 0 });
  });

  it("throws on an empty log", () => {
    expect(() => foldPlaybook([])).toThrow(/empty event log/);
  });
});
