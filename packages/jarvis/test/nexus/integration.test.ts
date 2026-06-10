import { describe, it, expect } from "vitest";
import { NexusEngine } from "../../src/nexus/engine.js";
import { RuleBasedRouter } from "../../src/nexus/router.js";
import { InProcessAgentPool } from "../../src/nexus/pool.js";
import { RuleBasedSynthesizer } from "../../src/nexus/synthesizer.js";
import { SimpleEventBus } from "../../src/event-bus/simple.js";
import { TaskBoard } from "../../src/nexus/task-board.js";
import { ReplayEngine } from "../../src/nexus/replay.js";
import type { Intent, JarvisContext } from "../../src/nexus/types.js";

describe("Nexus Integration", () => {
  const eventBus = new SimpleEventBus();
  const engine = new NexusEngine({
    intentRouter: new RuleBasedRouter(),
    agentPool: new InProcessAgentPool(),
    synthesizer: new RuleBasedSynthesizer(),
    eventBus,
    maxConcurrentAgents: 5,
    defaultTimeoutMs: 30000,
  });
  const taskBoard = new TaskBoard(eventBus);
  const replay = new ReplayEngine(eventBus);

  const context: JarvisContext = {
    sessionId: "sess-integ",
    userId: "user-1",
    recentIntents: [],
    currentTime: new Date(),
  };

  it("full pipeline: weather + calendar", async () => {
    const intent: Intent = { action: "get_updates", params: {}, confidence: 0.9, ambiguous: false };
    const synthesis = await engine.execute(intent, context);

    expect(synthesis.spoken).toMatch(/degrees/);
    expect(synthesis.spoken).toMatch(/Meeting/);
    expect(synthesis.visual).toBeDefined();
  });

  it("task board tracks all tasks", async () => {
    const intent: Intent = { action: "get_updates", params: {}, confidence: 0.9, ambiguous: false };
    await engine.execute(intent, context);

    const history = await taskBoard.getTaskHistory("sess-integ");
    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it("replay reconstructs conversation", async () => {
    const intent: Intent = { action: "search", params: {}, confidence: 0.9, ambiguous: false };
    await engine.execute(intent, context);

    const events = await replay.replay("sess-integ");
    expect(events.length).toBeGreaterThan(0);
    const types = events.map((e) => e.type);
    expect(types).toContain("intent_routed");
    expect(types).toContain("synthesis_complete");
  });
});
