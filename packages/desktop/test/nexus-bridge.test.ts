import { describe, it, expect } from "vitest";
import {
  NexusEngine,
  RuleBasedRouter,
  InProcessAgentPool,
  RuleBasedSynthesizer,
  TaskBoard,
} from "@openjarvis/jarvis/nexus";
import { SimpleEventBus } from "@openjarvis/jarvis";
import { createNexusBridge } from "../src/renderer/lib/nexus-bridge.js";

describe("NexusBridge", () => {
  function makeBridge() {
    const eventBus = new SimpleEventBus();
    const router = new RuleBasedRouter();
    const pool = new InProcessAgentPool();
    const synthesizer = new RuleBasedSynthesizer();
    const taskBoard = new TaskBoard(eventBus);
    const engine = new NexusEngine({
      intentRouter: router,
      agentPool: pool,
      synthesizer,
      eventBus,
      maxConcurrentAgents: 3,
      defaultTimeoutMs: 30000,
    });
    return createNexusBridge(engine, taskBoard, pool, eventBus);
  }

  it("getAgents returns 6 mock agents", async () => {
    const bridge = makeBridge();
    const agents = await bridge.getAgents();
    expect(agents).toHaveLength(6);
    expect(agents[0].id).toBe("research");
  });

  it("getTasks returns empty initially", async () => {
    const bridge = makeBridge();
    const tasks = await bridge.getTasks();
    expect(tasks).toEqual([]);
  });

  it("getMessages returns empty initially", async () => {
    const bridge = makeBridge();
    const messages = await bridge.getMessages();
    expect(messages).toEqual([]);
  });

  it("executeIntent adds a user message", async () => {
    const bridge = makeBridge();
    await bridge.executeIntent("check_weather", { location: "NYC" });
    const messages = await bridge.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("user");
  });

  it("subscribeToEvents returns an unsubscribe function", async () => {
    const bridge = makeBridge();
    const unsub = bridge.subscribeToEvents(() => {});
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
