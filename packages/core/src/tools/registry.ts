import type { ToolDefinition, ToolCall, ToolResult, ToolContext } from "./tool.js";
import { type AgentGrant, grantSatisfies } from "../security/capability.js";
import { type Logger, noopLogger } from "../observability/logger.js";
import type { MetricsCollector } from "../observability/metrics.js";
import { noopMetricsCollector } from "../observability/metrics.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyToolDefinition = ToolDefinition<any, any>;

/** Registry of typed, capability-gated tools. `invoke` never throws. */
export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  constructor(
    private readonly logger: Logger = noopLogger,
    private readonly metrics: MetricsCollector = noopMetricsCollector,
  ) {}

  // Generic public signature so callers get full type-checking on the tool they
  // pass; the single internal cast erases the type variables for heterogeneous
  // storage (recovering <A,R> from a string lookup is impossible anyway).
  register<A, R>(tool: ToolDefinition<A, R>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool as AnyToolDefinition);
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

    // Confused-deputy guard: the executing context must be the granted agent, so a
    // caller bug can't run a tool under the wrong agent's authority.
    if (grant.agentId !== ctx.agentId) {
      this.logger.log("error", "agent_mismatch", {
        tool: call.tool,
        grantAgent: grant.agentId,
        ctxAgent: ctx.agentId,
      });
      return fail(call, `agent mismatch: grant is for ${grant.agentId}, context is ${ctx.agentId}`);
    }

    // The Lab: default-deny capability gate.
    const missing = tool.capabilities.filter((c) => !grantSatisfies(grant, c));
    if (missing.length > 0) {
      this.logger.log("warn", "capability_denied", {
        tool: call.tool,
        missing: missing.map((c) => c.name),
      });
      return fail(call, `capability denied: ${missing.map((c) => c.name).join(", ")}`);
    }

    // Everything that can throw lives inside the try so `invoke` never throws:
    // arg `safeParse` can throw if a tool's schema uses a throwing transform/refine,
    // the handler can throw, and result `safeParse` can throw likewise.
    try {
      const parsedArgs = tool.args.safeParse(call.args);
      if (!parsedArgs.success) {
        return fail(call, `invalid args: ${parsedArgs.error.message}`);
      }
      const start = Date.now();
      let raw: unknown;
      try {
        raw = await tool.handler(parsedArgs.data, ctx);
      } finally {
        this.metrics.histogram("ToolCallLatency", Date.now() - start);
      }
      const parsedResult = tool.result.safeParse(raw);
      if (!parsedResult.success) {
        return fail(call, `invalid result: ${parsedResult.error.message}`);
      }
      return { id: call.id, tool: call.tool, ok: true, data: parsedResult.data };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.logger.log("error", "tool_threw", { tool: call.tool, error });
      return fail(call, error);
    }
  }
}

function fail(call: ToolCall, error: string): ToolResult {
  return { id: call.id, tool: call.tool, ok: false, error };
}
