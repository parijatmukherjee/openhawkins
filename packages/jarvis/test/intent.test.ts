import { describe, it, expect } from "vitest";
import type { Intent } from "../src/index.js";

describe("Intent vision actions", () => {
  it("vision_query is a valid string action", () => {
    const intent: Intent = {
      action: "vision_query",
      params: { query: "what do you see?" },
      confidence: 0.95,
      ambiguous: false,
    };
    expect(intent.action).toBe("vision_query");
  });

  it("vision_count is a valid string action", () => {
    const intent: Intent = {
      action: "vision_count",
      params: { target: "people" },
      confidence: 0.92,
      ambiguous: false,
    };
    expect(intent.action).toBe("vision_count");
  });

  it("vision_presence is a valid string action", () => {
    const intent: Intent = {
      action: "vision_presence",
      params: {},
      confidence: 0.88,
      ambiguous: false,
    };
    expect(intent.action).toBe("vision_presence");
  });

  it("vision_alert is a valid string action", () => {
    const intent: Intent = {
      action: "vision_alert",
      params: { eventType: "presence_change" },
      confidence: 1.0,
      ambiguous: false,
    };
    expect(intent.action).toBe("vision_alert");
  });
});
