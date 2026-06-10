import { describe, it, expect } from "vitest";
import { ReplayEngine } from "../../src/nexus/replay.js";
import { SimpleEventBus } from "../../src/event-bus/simple.js";
import { NexusEngine } from "../../src/nexus/engine.js";
import { RuleBasedRouter } from "../../src/nexus/router.js";
import { InProcessAgentPool } from "../../src/nexus/pool.js";
import { RuleBasedSynthesizer } from "../../src/nexus/synthesizer.js";
import type { Intent, JarvisContext } from "../../src/nexus/types.js";

describe("ReplayEngine", () => {
  const eventBus = new SimpleEventBus();
  const engine = new NexusEngine({
    intentRouter: new RuleBasedRouter(),
    agentPool: new InProcessAgentPool(),
    synthesizer: new RuleBasedSynthesizer(),
    eventBus,
    maxConcurrentAgents: 5,
    defaultTimeoutMs: 30000,
  });
  const replay = new ReplayEngine(eventBus);

  const context: JarvisContext = {
    sessionId: "sess-replay",
    userId: "user-1",
    recentIntents: [],
    currentTime: new Date(),
  };

  it("replays a session's events", async () => {
    const intent: Intent = { action: "search", params: {}, confidence: 0.9, ambiguous: false };
    await engine.execute(intent, context);

    const events = await replay.replay("sess-replay");
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("intent_routed");
  });

  it("replays from a specific index", async () => {
    const events = await replay.replayFrom("sess-replay", 2);
    expect(events.length).toBeGreaterThan(0);
  });
});
