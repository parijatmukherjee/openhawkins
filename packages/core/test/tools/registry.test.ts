import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../../src/tools/registry.js";
import type { ToolDefinition } from "../../src/tools/tool.js";
import type { AgentGrant } from "../../src/security/capability.js";
import { type Logger, type LogLevel } from "../../src/observability/logger.js";

function capturing(): {
  logger: Logger;
  records: { level: LogLevel; event: string; fields?: Record<string, unknown> | undefined }[];
} {
  const records: {
    level: LogLevel;
    event: string;
    fields?: Record<string, unknown> | undefined;
  }[] = [];
  return {
    logger: { log: (level, event, fields) => void records.push({ level, event, fields }) },
    records,
  };
}

const echoTool: ToolDefinition<{ msg: string }, { echoed: string }> = {
  name: "echo",
  description: "echoes its message",
  args: z.object({ msg: z.string().min(1) }),
  result: z.object({ echoed: z.string() }),
  capabilities: [{ name: "host:info" }],
  handler: async (args) => ({ echoed: args.msg }),
};

const grant: AgentGrant = { agentId: "probe-agent", capabilities: [{ name: "host:info" }] };
const ctx = { agentId: "probe-agent" };

describe("ToolRegistry", () => {
  it("registers a tool and lists it; rejects duplicate registration", () => {
    const reg = new ToolRegistry();
    reg.register(echoTool);
    expect(reg.list().map((t) => t.name)).toEqual(["echo"]);
    expect(() => reg.register(echoTool)).toThrow(/already registered/);
  });

  it("invokes a tool: capability ok, args valid -> ok result with validated data", async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool);
    const res = await reg.invoke({ id: "c1", tool: "echo", args: { msg: "hi" } }, grant, ctx);
    expect(res).toEqual({ id: "c1", tool: "echo", ok: true, data: { echoed: "hi" } });
  });

  it("returns ok:false for an unknown tool (never throws)", async () => {
    const reg = new ToolRegistry();
    const res = await reg.invoke({ id: "c2", tool: "nope", args: {} }, grant, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown tool/);
  });

  it("default-denies when the agent lacks the capability", async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool);
    const noGrant: AgentGrant = { agentId: "probe-agent", capabilities: [] };
    const res = await reg.invoke({ id: "c3", tool: "echo", args: { msg: "hi" } }, noGrant, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/capability denied/);
  });

  it("rejects invalid args via the Zod schema", async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool);
    const res = await reg.invoke({ id: "c4", tool: "echo", args: { msg: "" } }, grant, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid args/);
  });

  it("captures a throwing handler as ok:false (never throws)", async () => {
    const reg = new ToolRegistry();
    const boomTool: ToolDefinition<Record<string, never>, { ok: boolean }> = {
      name: "boom",
      description: "always throws",
      args: z.object({}),
      result: z.object({ ok: z.boolean() }),
      capabilities: [{ name: "host:info" }],
      handler: async () => {
        throw new Error("kaboom");
      },
    };
    reg.register(boomTool);
    const res = await reg.invoke({ id: "c5", tool: "boom", args: {} }, grant, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/kaboom/);
  });

  it("rejects a handler whose result fails its own schema", async () => {
    const reg = new ToolRegistry();
    const badTool: ToolDefinition<Record<string, never>, { n: number }> = {
      name: "bad",
      description: "returns the wrong shape",
      args: z.object({}),
      result: z.object({ n: z.number() }),
      capabilities: [{ name: "host:info" }],
      // @ts-expect-error deliberately returning the wrong shape to exercise result validation
      handler: async () => ({ n: "not-a-number" }),
    };
    reg.register(badTool);
    const res = await reg.invoke({ id: "c6", tool: "bad", args: {} }, grant, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/invalid result/);
  });

  it("fails fast on an agentId mismatch between grant and ctx (confused deputy)", async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool);
    const res = await reg.invoke({ id: "c7", tool: "echo", args: { msg: "hi" } }, grant, {
      agentId: "someone-else",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/agent mismatch/);
  });

  it("captures a throwing args schema as ok:false (never throws)", async () => {
    const reg = new ToolRegistry();
    const trapTool: ToolDefinition<unknown, { ok: boolean }> = {
      name: "trap",
      description: "its args schema throws during parse",
      args: z.object({ x: z.string() }).transform(() => {
        throw new Error("parse-trap");
      }),
      result: z.object({ ok: z.boolean() }),
      capabilities: [{ name: "host:info" }],
      handler: async () => ({ ok: true }),
    };
    reg.register(trapTool);
    const res = await reg.invoke({ id: "c8", tool: "trap", args: { x: "y" } }, grant, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/parse-trap/);
  });

  it("logs a warn event when a capability is denied", async () => {
    const { logger, records } = capturing();
    const reg = new ToolRegistry(logger);
    reg.register(echoTool);
    const noGrant: AgentGrant = { agentId: "probe-agent", capabilities: [] };
    await reg.invoke({ id: "c9", tool: "echo", args: { msg: "hi" } }, noGrant, ctx);
    expect(records).toContainEqual(
      expect.objectContaining({ level: "warn", event: "capability_denied" }),
    );
  });

  it("logs an error event when a tool handler throws", async () => {
    const { logger, records } = capturing();
    const reg = new ToolRegistry(logger);
    const boomTool: ToolDefinition<Record<string, never>, { ok: boolean }> = {
      name: "boom",
      description: "always throws",
      args: z.object({}),
      result: z.object({ ok: z.boolean() }),
      capabilities: [{ name: "host:info" }],
      handler: async () => {
        throw new Error("kaboom");
      },
    };
    reg.register(boomTool);
    await reg.invoke({ id: "c10", tool: "boom", args: {} }, grant, ctx);
    expect(records).toContainEqual(
      expect.objectContaining({ level: "error", event: "tool_threw" }),
    );
  });

  it("logs an error event on a confused-deputy agent mismatch", async () => {
    const { logger, records } = capturing();
    const reg = new ToolRegistry(logger);
    reg.register(echoTool);
    await reg.invoke({ id: "c11", tool: "echo", args: { msg: "hi" } }, grant, {
      agentId: "someone-else",
    });
    expect(records).toContainEqual(
      expect.objectContaining({ level: "error", event: "agent_mismatch" }),
    );
  });
});
