import { describe, it, expect } from "vitest";
import { AgentRun, type Operator, type PhaseHandler } from "../../src/playbook/agent-run.js";
import { PlaybookRun, type PlaybookRunDeps } from "../../src/playbook/runner.js";
import { DEFAULT_MANIFEST } from "../../src/playbook/manifest.js";
import { SoftGate, type PhaseGate } from "../../src/playbook/gates.js";
import { isPhaseEvent } from "../../src/playbook/events.js";
import { InMemoryEventStore } from "../../src/session/events.js";
import { InMemoryAuditLog } from "../../src/security/audit.js";
import { fixedClock } from "../../src/util/clock.js";
import type { AgentGrant } from "../../src/security/capability.js";
import type { Phase } from "../../src/playbook/manifest.js";

const OPERATOR_GRANT: AgentGrant = { agentId: "op", capabilities: [{ name: "playbook:override" }] };
const fakeGate = (v: Awaited<ReturnType<PhaseGate["evaluate"]>>): PhaseGate => ({
  evaluate: async () => v,
});

/** Approves every soft phase with a fixed actor/reason. */
const approveAll: Operator = {
  review: async () => ({ approve: true, actor: "op", reason: "ok" }),
};

function playbookDeps(over: Partial<PlaybookRunDeps> = {}): PlaybookRunDeps {
  return {
    manifest: DEFAULT_MANIFEST,
    sessionId: "s1",
    runId: "r1",
    store: new InMemoryEventStore(),
    audit: new InMemoryAuditLog(),
    grant: OPERATOR_GRANT,
    softGate: new SoftGate(),
    validateGate: fakeGate({ status: "passed" }),
    clock: fixedClock(1000),
    ...over,
  };
}

const phasesOf = async (store: InMemoryEventStore): Promise<string[]> =>
  (await store.read("s1")).filter(isPhaseEvent).map((e) => `${e.type}:${e.phase}`);

describe("AgentRun.run — clean run", () => {
  it("drives Research->...->Present, running handlers in order and auditing the trace", async () => {
    const d = playbookDeps();
    const seen: Phase[] = [];
    const handlers: Partial<Record<Phase, PhaseHandler>> = {
      Research: async ({ phase }) => void seen.push(phase),
      Plan: async ({ phase }) => void seen.push(phase),
      Tasks: async ({ phase }) => void seen.push(phase),
      Execute: async ({ phase }) => void seen.push(phase),
    };
    const playbook = await PlaybookRun.start(d);
    const result = await new AgentRun({ playbook, handlers, operator: approveAll }).run();

    expect(result).toEqual({ kind: "completed" });
    expect(seen).toEqual(["Research", "Plan", "Tasks", "Execute"]);
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual([
      "PhaseEntered:Research",
      "PhaseOverridden:Research",
      "PhaseEntered:Plan",
      "PhaseOverridden:Plan",
      "PhaseEntered:Tasks",
      "PhaseOverridden:Tasks",
      "PhaseEntered:Execute",
      "PhaseOverridden:Execute",
      "PhaseEntered:Validate",
      "PhaseGatePassed:Validate",
      "PhaseEntered:Present",
    ]);
    expect((await d.audit.verify()).ok).toBe(true);
  });

  it("returns completed immediately for a run already at the terminal phase", async () => {
    const d = playbookDeps();
    const playbook = await PlaybookRun.start(d);
    for (let i = 0; i < 4; i++) await playbook.override("op", "skip");
    await playbook.advance(); // Validate passed -> Present
    const before = (await (d.store as InMemoryEventStore).read("s1")).length;
    const result = await new AgentRun({ playbook, handlers: {}, operator: approveAll }).run();
    expect(result).toEqual({ kind: "completed" });
    expect((await (d.store as InMemoryEventStore).read("s1")).length).toBe(before);
  });
});

describe("AgentRun.run — robustness matrix", () => {
  it("replans when Validate fails once, re-running Plan..Execute, then completes", async () => {
    let calls = 0;
    const flakyValidate: PhaseGate = {
      evaluate: async () =>
        calls++ === 0 ? { status: "failed", reason: "red" } : { status: "passed" },
    };
    const d = playbookDeps({ validateGate: flakyValidate });
    const ran: Phase[] = [];
    const note: PhaseHandler = async ({ phase }) => void ran.push(phase);
    const handlers: Partial<Record<Phase, PhaseHandler>> = {
      Research: note,
      Plan: note,
      Tasks: note,
      Execute: note,
    };
    const playbook = await PlaybookRun.start(d);
    const result = await new AgentRun({ playbook, handlers, operator: approveAll }).run();

    expect(result).toEqual({ kind: "completed" });
    expect(ran.filter((p) => p === "Plan").length).toBe(2);
    expect(ran.filter((p) => p === "Execute").length).toBe(2);
    const events = await phasesOf(d.store as InMemoryEventStore);
    expect(events).toContain("PhaseGateFailed:Validate");
    expect(events[events.length - 1]).toBe("PhaseEntered:Present");
    expect((await d.audit.verify()).ok).toBe(true);
  });

  it("escalates when the replan budget is exhausted", async () => {
    const d = playbookDeps({
      manifest: { ...DEFAULT_MANIFEST, maxReplans: 0 },
      validateGate: fakeGate({ status: "failed", reason: "still red" }),
    });
    const note: PhaseHandler = async () => {};
    const playbook = await PlaybookRun.start(d);
    const result = await new AgentRun({
      playbook,
      handlers: { Research: note, Plan: note, Tasks: note, Execute: note },
      operator: approveAll,
    }).run();
    expect(result).toEqual({ kind: "escalated", phase: "Validate", reason: "still red" });
    expect((await d.audit.verify()).ok).toBe(true);
  });

  it("halts when the operator declines a soft phase", async () => {
    const d = playbookDeps();
    const decline: Operator = { review: async () => ({ approve: false }) };
    const playbook = await PlaybookRun.start(d);
    const result = await new AgentRun({ playbook, handlers: {}, operator: decline }).run();
    expect(result).toEqual({ kind: "halted-by-operator", phase: "Research" });
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual(["PhaseEntered:Research"]);
  });

  it("halts when an approving operator lacks the override capability (denied + audited)", async () => {
    const d = playbookDeps({ grant: { agentId: "op", capabilities: [] } });
    const playbook = await PlaybookRun.start(d);
    const result = await new AgentRun({ playbook, handlers: {}, operator: approveAll }).run();
    expect(result).toEqual({ kind: "halted-by-operator", phase: "Research" });
    const audit = await d.audit.entries();
    expect(audit.map((e) => e.kind)).toContain("PhaseOverrideDenied");
    expect((await d.audit.verify()).ok).toBe(true);
  });

  it("surfaces a throwing phase handler (work failure is not swallowed)", async () => {
    const d = playbookDeps();
    const boom: PhaseHandler = async () => {
      throw new Error("research tool crashed");
    };
    const playbook = await PlaybookRun.start(d);
    await expect(
      new AgentRun({ playbook, handlers: { Research: boom }, operator: approveAll }).run(),
    ).rejects.toThrow(/research tool crashed/);
    expect(await phasesOf(d.store as InMemoryEventStore)).toEqual(["PhaseEntered:Research"]);
  });
});
