import type { ToolDefinition, ToolCall, ToolResult, ToolContext } from "./tool.js";
import { type AgentGrant, grantSatisfies } from "../security/capability.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDefinition = ToolDefinition<any, any>;

/** Registry of typed, capability-gated tools. `invoke` never throws. */
export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register(tool: AnyToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): AnyToolDefinition[] {
    return [...this.tools.values()];
  }

  async invoke(call: ToolCall, grant: AgentGrant, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(call.tool);
    if (!tool) {
      return fail(call, `unknown tool: ${call.tool}`);
    }

    // The Lab: default-deny capability gate.
    const missing = tool.capabilities.filter((c) => !grantSatisfies(grant, c));
    if (missing.length > 0) {
      return fail(call, `capability denied: ${missing.map((c) => c.name).join(", ")}`);
    }

    // Validate args against the tool's Zod schema.
    const parsedArgs = tool.args.safeParse(call.args);
    if (!parsedArgs.success) {
      return fail(call, `invalid args: ${parsedArgs.error.message}`);
    }

    // Execute, then validate the result against its schema.
    try {
      const raw = await tool.handler(parsedArgs.data, ctx);
      const parsedResult = tool.result.safeParse(raw);
      if (!parsedResult.success) {
        return fail(call, `invalid result: ${parsedResult.error.message}`);
      }
      return { id: call.id, tool: call.tool, ok: true, data: parsedResult.data };
    } catch (err) {
      return fail(call, err instanceof Error ? err.message : String(err));
    }
  }
}

function fail(call: ToolCall, error: string): ToolResult {
  return { id: call.id, tool: call.tool, ok: false, error };
}
