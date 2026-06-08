import { describe, it, expect } from "vitest";
import { ScriptedAdapter } from "../../src/models/scripted.js";

describe("ScriptedAdapter", () => {
  it("returns fixed steps in order and counts calls", async () => {
    const adapter = new ScriptedAdapter([
      { content: "first", toolCalls: [] },
      { content: "second", toolCalls: [] },
    ]);
    expect(adapter.calls).toBe(0);
    expect((await adapter.generate({ messages: [] })).content).toBe("first");
    expect((await adapter.generate({ messages: [] })).content).toBe("second");
    expect(adapter.calls).toBe(2);
  });

  it("supports function steps that react to the running conversation", async () => {
    const adapter = new ScriptedAdapter([
      (req) => ({ content: `saw ${req.messages.length} messages`, toolCalls: [] }),
    ]);
    const res = await adapter.generate({
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
    });
    expect(res.content).toBe("saw 2 messages");
  });

  it("throws once the script is exhausted (catches loops that over-call the model)", async () => {
    const adapter = new ScriptedAdapter([{ content: "only", toolCalls: [] }]);
    await adapter.generate({ messages: [] });
    await expect(adapter.generate({ messages: [] })).rejects.toThrow(/exhausted after 1 step/);
  });
});
