import { describe, it, expect } from "vitest";
import {
  VisionEngine,
  VisionConfig,
  VisionFrame,
  DetectedObject,
  PresenceState,
} from "../../src/vision/engine.js";

describe("VisionEngine interface", () => {
  it("should have start method", () => {
    const engine: VisionEngine = {
      start: async () => {},
      stop: async () => {},
      captureBurst: async () => [],
      getPresenceState: () => "unknown",
    };
    expect(engine.start).toBeDefined();
  });

  it("should have correct VisionConfig defaults", () => {
    const config: VisionConfig = {
      pollFps: 2,
      idleFps: 0.5,
      idleTimeoutMs: 300000,
      burstFps: 10,
      burstDurationMs: 3000,
      detectionConfidence: 0.6,
    };
    expect(config.pollFps).toBe(2);
    expect(config.idleFps).toBe(0.5);
  });

  it("should have correct PresenceState union", () => {
    const states: PresenceState[] = ["unknown", "present", "away", "multiple_people"];
    expect(states).toHaveLength(4);
  });
});
