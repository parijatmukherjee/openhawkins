import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  VisionEngine,
  VisionConfig,
  VisionFrame,
  DetectedObject,
  PresenceState,
  BurstOptions,
} from "../../src/index.js";

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

  it("should accept valid VisionConfig values", () => {
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
    expectTypeOf<PresenceState>().toEqualTypeOf<
      "unknown" | "present" | "away" | "multiple_people"
    >();
  });

  it("should accept valid BurstOptions values", () => {
    const options: BurstOptions = {
      durationMs: 3000,
      fps: 10,
      reason: "motion_detected",
    };
    expect(options.durationMs).toBe(3000);
    expect(options.fps).toBe(10);
  });

  it("should accept valid VisionFrame values", () => {
    const frame: VisionFrame = {
      frameId: "frame-1",
      timestamp: Date.now(),
      width: 1920,
      height: 1080,
      objects: [],
    };
    expect(frame.frameId).toBe("frame-1");
  });

  it("should accept valid DetectedObject values", () => {
    const obj: DetectedObject = {
      label: "person",
      confidence: 0.95,
      bbox: { x: 10, y: 20, width: 100, height: 200 },
    };
    expect(obj.label).toBe("person");
  });
});
