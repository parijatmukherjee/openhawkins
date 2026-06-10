import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { Agent } from "../../src/eval/agent.js";
import { ScriptedAdapter } from "../../src/models/scripted.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { diskFreeTool } from "../../src/tools/disk-free.js";
import { fixedClock } from "../../src/util/clock.js";
import type { AgentGrant } from "../../src/security/capability.js";
import type { MetricsCollector } from "../../src/observability/metrics.js";

const grant: AgentGrant = { agentId: "probe-agent", capabilities: [{ name: "host:info" }] };

function registry(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(diskFreeTool);
  return r;
}

describe("Agent (runtime facade) — audit branches", () => {
  it("audits a GroundingFailed turn when the model-call budget is exhausted", async () => {
    const adapter = new ScriptedAdapter([
      { content: "guess 1", toolCalls: [] },
      { content: "guess 2", toolCalls: [] },
    ]);
    const agent = await Agent.start({
      agentId: "probe-agent",
      adapter,
      registry: registry(),
      grant,
      tools: [diskFreeTool],
      grounding: { mode: "required", qualifyingTools: ["disk_free"] },
      maxModelCalls: 2,
      clock: fixedClock(0),
    });

    const record = await agent.ask("disk?");
    expect(record.accepted).toBe(false);
    const kinds = (await agent.audit.entries()).map((e) => e.kind);
    expect(kinds).toContain("GroundingFailed");
    expect((await agent.audit.verify()).ok).toBe(true);
  });

  it("audits a failed (capability-denied) tool call with its error", async () => {
    const adapter = new ScriptedAdapter([
      { content: "", toolCalls: [{ id: "oc-1", tool: "disk_free", args: { path: tmpdir() } }] },
      { content: JSON.stringify({ unknown: true, reason: "denied" }), toolCalls: [] },
    ]);
    const noGrant: AgentGrant = { agentId: "probe-agent", capabilities: [] };
    const agent = await Agent.start({
      agentId: "probe-agent",
      adapter,
      registry: registry(),
      grant: noGrant,
      tools: [diskFreeTool],
      grounding: { mode: "required", qualifyingTools: ["disk_free"] },
      clock: fixedClock(0),
    });

    const record = await agent.ask("disk?");
    expect(record.accepted).toBe(true); // honest unknown accepted
    const toolEntry = (await agent.audit.entries()).find((e) => e.kind === "ToolReturned");
    expect(toolEntry?.data).toMatchObject({ tool: "disk_free", ok: false });
    expect((toolEntry?.data as { error: string }).error).toMatch(/capability denied/);
  });

  it("records the ungrounded flag from preferred mode in the FinalAccepted entry", async () => {
    const adapter = new ScriptedAdapter([{ content: "a guess", toolCalls: [] }]);
    const agent = await Agent.start({
      agentId: "probe-agent",
      adapter,
      registry: registry(),
      grant,
      tools: [diskFreeTool],
      grounding: { mode: "preferred", qualifyingTools: ["disk_free"] },
      clock: fixedClock(0),
    });

    const record = await agent.ask("disk?");
    expect(record.flagged).toBe("ungrounded");
    const finalEntry = (await agent.audit.entries()).find((e) => e.kind === "FinalAccepted");
    expect((finalEntry?.data as { flagged?: string }).flagged).toBe("ungrounded");
  });

  it("runs with no system prompt when grounding is off (no instruction appended)", async () => {
    const adapter = new ScriptedAdapter([{ content: "hi", toolCalls: [] }]);
    const agent = await Agent.start({
      agentId: "probe-agent",
      adapter,
      registry: registry(),
      grant,
      tools: [diskFreeTool],
      grounding: { mode: "off" },
      clock: fixedClock(0),
    });

    const record = await agent.ask("hi");
    expect(record.accepted).toBe(true);
    expect(record.final).toBe("hi");
    // The very first model request carries no system message.
    expect(record.modelCalls[0].request[0].role).toBe("user");
  });

  it("generates a traceId per turn and threads it through audit entries", async () => {
    const adapter = new ScriptedAdapter([{ content: "hi", toolCalls: [] }]);
    const agent = await Agent.start({
      agentId: "probe-agent",
      adapter,
      registry: registry(),
      grant,
      tools: [diskFreeTool],
      grounding: { mode: "off" },
      clock: fixedClock(0),
    });

    const record = await agent.ask("hi");
    expect(record.traceId).toBeDefined();
    expect(typeof record.traceId).toBe("string");

    const entries = await agent.audit.entries();
    const finalEntry = entries.find((e) => e.kind === "FinalAccepted");
    expect((finalEntry?.data as { traceId?: string }).traceId).toBe(record.traceId);
  });

  it("records ModelResponseLatency histogram for each model call", async () => {
    const histograms: { name: string; value: number }[] = [];
    const metrics: MetricsCollector = {
      increment() {},
      histogram: (name, value) => void histograms.push({ name, value }),
    };
    const adapter = new ScriptedAdapter([
      { content: "first", toolCalls: [] },
      { content: "second", toolCalls: [] },
    ]);
    const agent = await Agent.start({
      agentId: "probe-agent",
      adapter,
      registry: registry(),
      grant,
      tools: [diskFreeTool],
      grounding: { mode: "off" },
      clock: fixedClock(0),
      metrics,
    });

    const record = await agent.ask("hi");
    expect(record.accepted).toBe(true);
    expect(histograms).toHaveLength(record.modelCalls.length);
    expect(histograms.every((h) => h.name === "ModelResponseLatency")).toBe(true);
    expect(histograms.every((h) => h.value >= 0)).toBe(true);
  });
});
