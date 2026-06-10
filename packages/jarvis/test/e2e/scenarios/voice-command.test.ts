import { describe, it, expect } from "vitest";
import { MockUser } from "../../../src/e2e/mock-user.js";

describe("E2E: Voice command", () => {
  it("should respond to 'what time is it?'", async () => {
    const hub = createMockHub();
    const user = new MockUser(hub);
    await user.say("what time is it?");
    expect(user.listen()).toMatch(/3:45 PM/);
  });
});

function createMockHub() {
  const commands: unknown[] = [];
  const events: unknown[] = [];
  const audit: unknown[] = [];
  let lastTts = "";

  return {
    wakeWordEngine: { start: async () => {} },
    sttEngine: {
      transcribe: async (_text: string) => {
        events.push({ topic: "intent", type: "parsed", action: "get_time" });
        lastTts = "It's 3:45 PM";
        audit.push({ action: "get_time" });
      },
    },
    ttsEngine: { getLastOutput: () => lastTts },
    displayManager: { getCommands: () => commands },
    visionEngine: { getEvents: () => [] },
    eventBus: { getEvents: () => events },
    auditLog: { getEntries: () => audit },
  };
}
