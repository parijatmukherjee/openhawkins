import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { runAgentTurn, acceptAlways } from "../../src/loop/agent-loop.js";
import { ScriptedAdapter } from "../../src/models/scripted.js";
import { ToolRegistry } from "../../src/tools/registry.js";
import { diskFreeTool } from "../../src/tools/disk-free.js";
import type { AgentGrant } from "../../src/security/capability.js";
import type { AcceptPolicy } from "../../src/loop/turn.js";

const grant: AgentGrant = {
  agentId: "probe-agent",
  capabilities: [{ name: "host:info" }],
};

function registryWithDiskFree(): ToolRegistry {
  const reg = new ToolRegistry();
  reg.register(diskFreeTool);
  return reg;
}

describe("runAgentTurn (native tool-calling round-trip)", () => {
  it("runs a real tool call through the registry and feeds the result back to the model", async () => {
    // A weak model: first it asks to call disk_free, then it answers using the
    // REAL number the real tool returned for this machine.
    const adapter = new ScriptedAdapter([
      { content: "", toolCalls: [{ id: "oc-1", tool: "disk_free", args: { path: tmpdir() } }] },
      (req) => {
        // The tool result was fed back as the last `tool` message.
        const toolMsg = req.messages.findLast((m) => m.role === "tool");
        const data = JSON.parse(toolMsg!.content) as { data: { freeBytes: number } };
        return { content: `Free: ${data.data.freeBytes} bytes`, toolCalls: [] };
      },
    ]);

    const record = await runAgentTurn(
      { adapter, registry: registryWithDiskFree(), grant, tools: [diskFreeTool] },
      "How much disk is free?",
    );

    expect(record.accepted).toBe(true);
    expect(record.toolCalls).toHaveLength(1);
    expect(record.toolCalls[0].result.ok).toBe(true);
    const freeBytes = (record.toolCalls[0].result.data as { freeBytes: number }).freeBytes;
    expect(freeBytes).toBeGreaterThan(0);
    // The accepted final reflects the actual tool result, not a guess.
    expect(record.final).toBe(`Free: ${freeBytes} bytes`);
    expect(adapter.calls).toBe(2);
  });

  it("exposes tool schemas to the model derived from the tool's Zod args", async () => {
    let sawTools: unknown;
    const adapter = new ScriptedAdapter([
      (req) => {
        sawTools = req.tools;
        return { content: "done", toolCalls: [] };
      },
    ]);

    await runAgentTurn(
      { adapter, registry: registryWithDiskFree(), grant, tools: [diskFreeTool] },
      "hi",
    );

    expect(sawTools).toEqual([
      {
        name: "disk_free",
        description: diskFreeTool.description,
        parameters: expect.objectContaining({ type: "object" }),
      },
    ]);
  });

  it("records a denied tool call (capability gate) without throwing", async () => {
    const adapter = new ScriptedAdapter([
      { content: "", toolCalls: [{ id: "oc-1", tool: "disk_free", args: { path: tmpdir() } }] },
      { content: "I could not read host facts.", toolCalls: [] },
    ]);
    const noGrant: AgentGrant = { agentId: "probe-agent", capabilities: [] };

    const record = await runAgentTurn(
      { adapter, registry: registryWithDiskFree(), grant: noGrant, tools: [diskFreeTool] },
      "disk?",
    );

    expect(record.toolCalls[0].result.ok).toBe(false);
    expect(record.toolCalls[0].result.error).toMatch(/capability denied/);
    expect(record.accepted).toBe(true); // loop continues; grounding is S1.5's job
  });

  it("re-prompts with the policy's correction, then accepts (enforcement loop)", async () => {
    // The policy rejects the first final, accepts the second.
    let calls = 0;
    const policy: AcceptPolicy = {
      evaluate: () =>
        calls++ === 0 ? { accept: false, correction: "Call the tool first." } : { accept: true },
    };
    const adapter = new ScriptedAdapter([
      { content: "It's about 100GB.", toolCalls: [] },
      { content: "Free: 123 bytes", toolCalls: [] },
    ]);

    const record = await runAgentTurn(
      { adapter, registry: registryWithDiskFree(), grant, tools: [diskFreeTool], policy },
      "disk?",
    );

    expect(record.corrections).toEqual(["Call the tool first."]);
    expect(record.final).toBe("Free: 123 bytes");
    expect(record.accepted).toBe(true);
  });

  it("stops at the model-call budget and returns an unaccepted (grounded-failure) record", async () => {
    const neverAccept: AcceptPolicy = { evaluate: () => ({ accept: false, correction: "again" }) };
    const adapter = new ScriptedAdapter([
      { content: "guess 1", toolCalls: [] },
      { content: "guess 2", toolCalls: [] },
    ]);

    const record = await runAgentTurn(
      {
        adapter,
        registry: registryWithDiskFree(),
        grant,
        tools: [diskFreeTool],
        policy: neverAccept,
        maxModelCalls: 2,
      },
      "disk?",
    );

    expect(record.accepted).toBe(false);
    expect(record.final).toBeUndefined();
    expect(record.modelCalls).toHaveLength(2);
  });

  it("acceptAlways accepts the very first final with no tools called", async () => {
    const adapter = new ScriptedAdapter([{ content: "hello", toolCalls: [] }]);
    const record = await runAgentTurn(
      {
        adapter,
        registry: registryWithDiskFree(),
        grant,
        tools: [diskFreeTool],
        policy: acceptAlways,
      },
      "hi",
    );
    expect(record.accepted).toBe(true);
    expect(record.toolCalls).toHaveLength(0);
  });
});
