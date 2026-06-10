import { describe, it, expect } from "vitest";
import { RuleBasedSynthesizer } from "../../src/nexus/synthesizer.js";
import type { AgentResult, Intent, JarvisContext } from "../../src/nexus/types.js";

describe("RuleBasedSynthesizer", () => {
  const synthesizer = new RuleBasedSynthesizer();
  const context: JarvisContext = {
    sessionId: "sess-1",
    userId: "user-1",
    recentIntents: [],
    currentTime: new Date(),
  };

  it("synthesizes weather result", async () => {
    const intent: Intent = { action: "check_weather", params: {}, confidence: 0.9, ambiguous: false };
    const results: AgentResult[] = [{ agentId: "weather", success: true, output: { temp: 72, condition: "sunny" } }];
    const synthesis = await synthesizer.synthesize(results, intent, context);
    expect(synthesis.spoken).toMatch(/72/);
    expect(synthesis.spoken).toMatch(/sunny/);
  });

  it("synthesizes parallel weather + calendar results", async () => {
    const intent: Intent = { action: "get_updates", params: {}, confidence: 0.9, ambiguous: false };
    const results: AgentResult[] = [
      { agentId: "weather", success: true, output: { temp: 72, condition: "sunny" } },
      { agentId: "calendar", success: true, output: { events: [{ title: "Meeting", time: "10:00" }] } },
    ];
    const synthesis = await synthesizer.synthesize(results, intent, context);
    expect(synthesis.spoken).toMatch(/72/);
    expect(synthesis.spoken).toMatch(/Meeting/);
    expect(synthesis.visual).toBeDefined();
    expect(synthesis.visual!.length).toBeGreaterThan(0);
  });

  it("handles failed agent gracefully", async () => {
    const intent: Intent = { action: "get_updates", params: {}, confidence: 0.9, ambiguous: false };
    const results: AgentResult[] = [
      { agentId: "weather", success: true, output: { temp: 72 } },
      { agentId: "calendar", success: false, error: "Calendar unavailable" },
    ];
    const synthesis = await synthesizer.synthesize(results, intent, context);
    expect(synthesis.spoken).toMatch(/72/);
    expect(synthesis.spoken).toMatch(/unavailable/);
  });
});
