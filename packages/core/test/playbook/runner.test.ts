import { describe, it, expect } from "vitest";
import { PlaybookRun, type PlaybookRunDeps } from "../../src/playbook/runner.js";
import { DEFAULT_MANIFEST } from "../../src/playbook/manifest.js";
import { SoftGate, ValidateGate, type PhaseGate } from "../../src/playbook/gates.js";
import { foldPlaybook, isPhaseEvent } from "../../src/playbook/events.js";
import { InMemoryEventStore } from "../../src/session/events.js";
import { InMemoryAuditLog } from "../../src/security/audit.js";
import { fixedClock } from "../../src/util/clock.js";
import type { AgentGrant } from "../../src/security/capability.js";

const OPERATOR: AgentGrant = {
  agentId: "op",
  capabilities: [{ name: "playbook:override" }],
};

/** A gate that always returns the same verdict — stands in for SoftGate/ValidateGate.
 *  Used by the advance/override describe blocks appended in later tasks. */
function fakeGate(verdict: Awaited<ReturnType<PhaseGate["evaluate"]>>): PhaseGate {
  return { evaluate: async () => verdict };
}

function deps(overrides: Partial<PlaybookRunDeps> = {}): PlaybookRunDeps {
  return {
    manifest: DEFAULT_MANIFEST,
    sessionId: "s1",
    runId: "r1",
    store: new InMemoryEventStore(),
    audit: new InMemoryAuditLog(),
    grant: OPERATOR,
    softGate: new SoftGate(),
    validateGate: new ValidateGate(async () => ({ ok: true })),
    clock: fixedClock(1000),
    ...overrides,
  };
}

describe("PlaybookRun.start", () => {
  it("enters the manifest's first phase, recording one event and one audit entry", async () => {
    const d = deps();
    const run = await PlaybookRun.start(d);
    expect(run.state).toEqual({ phase: "Research", replans: 0 });
    expect(run.status()).toEqual({ kind: "running", phase: "Research" });

    const events = (await d.store.read("s1")).filter(isPhaseEvent);
    expect(events).toEqual([
      { type: "PhaseEntered", sessionId: "s1", runId: "r1", phase: "Research", at: 1000 },
    ]);

    const audit = await d.audit.entries();
    expect(audit.map((e) => e.kind)).toEqual(["PhaseEntered"]);
    expect((await d.audit.verify()).ok).toBe(true);
  });

  it("throws if the manifest has no phases", async () => {
    await expect(
      PlaybookRun.start(deps({ manifest: { phases: [], maxReplans: 3 } })),
    ).rejects.toThrow(/no phases/);
  });

  it("falls back to the system clock when none is supplied", async () => {
    const d = deps();
    delete d.clock; // exercise the `?? systemClock` fallback
    const before = Date.now();
    await PlaybookRun.start(d);
    const [event] = (await d.store.read("s1")).filter(isPhaseEvent);
    expect(event?.at).toBeGreaterThanOrEqual(before);
  });
});

const phasesOf = async (store: InMemoryEventStore): Promise<string[]> =>
  (await store.read("s1")).filter(isPhaseEvent).map((e) => `${e.type}:${e.phase}`);

describe("PlaybookRun.advance", () => {
  it("a passed gate advances and records GatePassed + Entered", async () => {
    const d = deps({ softGate: fakeGate({ status: "passed" }) });
    const run = await PlaybookRun.start(d);
    const status = await run.advance();
    expect(status).toEqual({ kind: "running", phase: "Plan" });
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual([
      "PhaseEntered:Research",
      "PhaseGatePassed:Research",
      "PhaseEntered:Plan",
    ]);
    expect((await d.audit.verify()).ok).toBe(true);
  });

  it("a soft gate pauses the run awaiting an operator (no new events)", async () => {
    const d = deps(); // real SoftGate -> needs-operator
    const run = await PlaybookRun.start(d);
    const status = await run.advance();
    expect(status.kind).toBe("awaiting-operator");
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual(["PhaseEntered:Research"]);
  });

  it("a failed Validate replans to Plan, recording GateFailed(escalate:false) + Entered", async () => {
    const d = deps({ validateGate: fakeGate({ status: "failed", reason: "coverage 98%" }) });
    const run = await PlaybookRun.start(d);
    await run.override("op", "skip research"); // Research -> Plan
    await run.override("op", "skip plan"); // Plan -> Tasks
    await run.override("op", "skip tasks"); // Tasks -> Execute
    await run.override("op", "skip execute"); // Execute -> Validate
    expect(run.state.phase).toBe("Validate");
    const status = await run.advance(); // Validate fails
    expect(status).toEqual({ kind: "running", phase: "Plan" });
    expect(run.state).toEqual({ phase: "Plan", replans: 1 });
    const events = await phasesOf(d.store as InMemoryEventStore);
    expect(events).toContain("PhaseGateFailed:Validate");
    expect(events[events.length - 1]).toBe("PhaseEntered:Plan");
    expect((await d.audit.verify()).ok).toBe(true);
  });

  it("escalates when the replan budget is exhausted", async () => {
    const d = deps({
      manifest: { ...DEFAULT_MANIFEST, maxReplans: 0 },
      validateGate: fakeGate({ status: "failed", reason: "still red" }),
    });
    const run = await PlaybookRun.start(d);
    await run.override("op", "to plan"); // Research -> Plan
    await run.override("op", "to tasks"); // Plan -> Tasks
    await run.override("op", "to execute"); // Tasks -> Execute
    await run.override("op", "to validate"); // Execute -> Validate
    const status = await run.advance(); // fails; replans (0) >= maxReplans (0) -> escalate
    expect(status).toEqual({ kind: "escalated", phase: "Validate", reason: "still red" });
    const events = await phasesOf(d.store as InMemoryEventStore);
    expect(events[events.length - 1]).toBe("PhaseGateFailed:Validate");
    expect((await d.audit.verify()).ok).toBe(true);

    // re-advancing an escalated run is a no-op: it stays escalated and emits no new event
    const countBefore = (await (d.store as InMemoryEventStore).read("s1")).length;
    expect(await run.advance()).toEqual({
      kind: "escalated",
      phase: "Validate",
      reason: "still red",
    });
    expect((await (d.store as InMemoryEventStore).read("s1")).length).toBe(countBefore);
  });

  it("advancing at the terminal phase is a no-op returning done", async () => {
    const d = deps({ validateGate: fakeGate({ status: "passed" }) });
    const run = await PlaybookRun.start(d);
    for (let i = 0; i < 4; i++) await run.override("op", "skip"); // -> Validate
    await run.advance(); // Validate passed -> Present (done)
    expect(run.status()).toEqual({ kind: "done", phase: "Present" });
    const before = (await (d.store as InMemoryEventStore).read("s1")).length;
    expect(await run.advance()).toEqual({ kind: "done", phase: "Present" });
    const after = (await (d.store as InMemoryEventStore).read("s1")).length;
    expect(after).toBe(before); // no new events at terminal
  });

  it("the folded event log is the single source of truth for replans (F-H2)", async () => {
    const d = deps({ validateGate: fakeGate({ status: "failed", reason: "red" }) });
    const run = await PlaybookRun.start(d);
    await run.override("op", "to plan"); // Research -> Plan
    await run.override("op", "to tasks"); // Plan -> Tasks
    await run.override("op", "to execute"); // Tasks -> Execute
    await run.override("op", "to validate"); // Execute -> Validate
    await run.advance(); // Validate fails -> replan (replans 0 -> 1)

    const log = (await (d.store as InMemoryEventStore).read("s1")).filter(isPhaseEvent);
    // The live runtime count and the count re-derived purely from the event log agree —
    // there is no second place that could drift.
    expect(foldPlaybook(log).replans).toBe(run.state.replans);
    expect(run.state.replans).toBe(1);
  });
});

describe("PlaybookRun.override", () => {
  it("a granted override advances a paused soft phase, recording PhaseOverridden", async () => {
    const d = deps(); // SoftGate pauses Research; OPERATOR holds playbook:override
    const run = await PlaybookRun.start(d);
    await run.advance(); // -> awaiting-operator at Research
    const status = await run.override("alice", "spikes done");
    expect(status).toEqual({ kind: "running", phase: "Plan" });
    const events = await phasesOf(d.store as InMemoryEventStore);
    expect(events).toEqual([
      "PhaseEntered:Research",
      "PhaseOverridden:Research",
      "PhaseEntered:Plan",
    ]);
    expect((await d.audit.verify()).ok).toBe(true);
  });

  it("a denied override (no capability) changes nothing but audits the attempt", async () => {
    const noGrant: AgentGrant = { agentId: "op", capabilities: [] };
    const d = deps({ grant: noGrant });
    const run = await PlaybookRun.start(d);
    await run.advance(); // awaiting-operator at Research
    const status = await run.override("mallory", "skip it");
    expect(status.kind).toBe("awaiting-operator");
    expect(run.state).toEqual({ phase: "Research", replans: 0 });
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual(["PhaseEntered:Research"]);
    const audit = await d.audit.entries();
    expect(audit.map((e) => e.kind)).toContain("PhaseOverrideDenied");
    expect((await d.audit.verify()).ok).toBe(true);
  });

  it("a granted override at the terminal phase is a no-op done", async () => {
    const d = deps({ validateGate: fakeGate({ status: "passed" }) });
    const run = await PlaybookRun.start(d);
    for (let i = 0; i < 4; i++) await run.override("op", "skip"); // -> Validate
    await run.advance(); // Validate passed -> Present
    const before = (await (d.store as InMemoryEventStore).read("s1")).length;
    expect(await run.override("op", "noop")).toEqual({ kind: "done", phase: "Present" });
    const after = (await (d.store as InMemoryEventStore).read("s1")).length;
    expect(after).toBe(before); // no new events overriding at terminal
  });
});
