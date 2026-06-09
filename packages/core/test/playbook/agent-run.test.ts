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
    expect(await d.audit.verify()).toBe(true);
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
