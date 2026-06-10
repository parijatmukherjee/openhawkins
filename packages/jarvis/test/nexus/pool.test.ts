import { describe, it, expect } from "vitest";
import { InProcessAgentPool } from "../../src/nexus/pool.js";
import type { AgentRoute, AgentContext } from "../../src/nexus/types.js";

describe("InProcessAgentPool", () => {
  const pool = new InProcessAgentPool();
  const context: AgentContext = { sessionId: "sess-1", intent: { action: "search", params: {}, confidence: 0.9, ambiguous: false } };

  it("lists available agents", async () => {
    const agents = await pool.list();
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]).toHaveProperty("id");
    expect(agents[0]).toHaveProperty("name");
  });

  it("executes a mock agent and returns result", async () => {
    const route: AgentRoute = { agentId: "research", confidence: 0.9, required: true };
    const result = await pool.execute(route, context);
    expect(result.agentId).toBe("research");
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
  });

  it("handles timeout gracefully", async () => {
    const route: AgentRoute = { agentId: "slow", confidence: 0.9, required: false, timeoutMs: 50 };
    const result = await pool.execute(route, context);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/timeout/i);
  });

  it("returns unknown agent as failed", async () => {
    const route: AgentRoute = { agentId: "nonexistent", confidence: 0.9, required: false };
    const result = await pool.execute(route, context);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown agent/i);
  });
});
