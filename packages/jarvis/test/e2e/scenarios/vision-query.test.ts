import { describe, it, expect } from "vitest";
import { MockUser } from "../../../src/e2e/mock-user.js";

describe("E2E: Vision query", () => {
  it("should respond to 'what do you see?'", async () => {
    const hub = createMockHub();
    const user = new MockUser(hub);
    await user.say("what do you see?");
    expect(user.listen()).toMatch(/I see a person and a coffee mug/);
    expect(user.seeScreen()).toContainEqual(
      expect.objectContaining({ type: "open_vision_feed" }),
    );
  });
});

function createMockHub() {
  const commands: unknown[] = [];
  const events: unknown[] = [];
  let lastTts = "";

  return {
    wakeWordEngine: { start: async () => {} },
    sttEngine: {
      transcribe: async (_text: string) => {
        events.push({ topic: "intent", type: "parsed", action: "vision_query" });
        events.push({
          topic: "vision",
          type: "frame",
          payload: { objects: [{ label: "person" }, { label: "cup" }] },
        });
        commands.push({ type: "open_vision_feed" });
        lastTts = "I see a person and a coffee mug";
      },
    },
    ttsEngine: { getLastOutput: () => lastTts },
    displayManager: { getCommands: () => commands },
    visionEngine: { getEvents: () => events.filter((e) => (e as { topic?: string }).topic === "vision") },
    eventBus: { getEvents: () => events },
    auditLog: { getEntries: () => [] },
  };
}
