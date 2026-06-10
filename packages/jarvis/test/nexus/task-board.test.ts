import { describe, it, expect } from "vitest";
import { TaskBoard } from "../../src/nexus/task-board.js";
import { SimpleEventBus } from "../../src/event-bus/simple.js";

describe("TaskBoard", () => {
  const eventBus = new SimpleEventBus();
  const board = new TaskBoard(eventBus);

  it("tracks active tasks", async () => {
    await eventBus.publish({
      topic: "nexus",
      payload: { type: "task_started", taskId: "t1", agentId: "weather", description: "Get weather", sessionId: "s1", at: Date.now() },
      timestamp: Date.now(),
      source: "nexus",
    });

    const active = await board.getActiveTasks("s1");
    expect(active).toHaveLength(1);
    expect(active[0].agentId).toBe("weather");
    expect(active[0].status).toBe("running");
  });

  it("moves task to completed", async () => {
    await eventBus.publish({
      topic: "nexus",
      payload: { type: "task_completed", taskId: "t1", agentId: "weather", success: true, sessionId: "s1", at: Date.now() },
      timestamp: Date.now(),
      source: "nexus",
    });

    const active = await board.getActiveTasks("s1");
    expect(active).toHaveLength(0);

    const history = await board.getTaskHistory("s1");
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("completed");
  });
});
