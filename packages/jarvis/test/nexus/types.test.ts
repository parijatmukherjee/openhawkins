import { describe, it, expect } from "vitest";
import type { Intent, DispatchPlan, AgentRoute, AgentResult, Synthesis } from "../../../src/nexus/types.js";

describe("Nexus types", () => {
  it("Intent has required fields", () => {
    const intent: Intent = { action: "search", params: { query: "test" }, confidence: 0.9, ambiguous: false };
    expect(intent.action).toBe("search");
    expect(intent.confidence).toBe(0.9);
  });

  it("DispatchPlan supports parallel and sequential", () => {
    const plan: DispatchPlan = {
      parallel: [{ agentId: "weather", confidence: 0.9, required: false }],
      sequential: [{ agentId: "search", confidence: 0.8, required: true }],
    };
    expect(plan.parallel).toHaveLength(1);
    expect(plan.sequential).toHaveLength(1);
  });

  it("AgentResult includes success and output", () => {
    const result: AgentResult = { agentId: "weather", success: true, output: { temp: 72 } };
    expect(result.success).toBe(true);
  });

  it("Synthesis includes spoken and visual", () => {
    const synthesis: Synthesis = {
      spoken: "It's 72 degrees.",
      visual: [{ type: "show_text", text: "72°F", monitor: 1 }],
    };
    expect(synthesis.spoken).toBe("It's 72 degrees.");
  });
});
