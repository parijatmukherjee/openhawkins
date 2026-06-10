import { describe, it, expect } from "vitest";
import { MockVisionEngine, MockDetectionModel } from "../../src/vision/mock.js";
import type { VisionConfig, BurstOptions } from "../../src/vision/engine.js";

describe("MockVisionEngine", () => {
  it("start() sets presence to present", async () => {
    const engine = new MockVisionEngine();
    const config: VisionConfig = {
      pollFps: 2,
      idleFps: 0.5,
      idleTimeoutMs: 300000,
      burstFps: 10,
      burstDurationMs: 3000,
      detectionConfidence: 0.6,
    };
    await engine.start(config);
    expect(engine.getPresenceState()).toBe("present");
  });

  it("stop() sets presence to unknown", async () => {
    const engine = new MockVisionEngine();
    const config: VisionConfig = {
      pollFps: 2,
      idleFps: 0.5,
      idleTimeoutMs: 300000,
      burstFps: 10,
      burstDurationMs: 3000,
      detectionConfidence: 0.6,
    };
    await engine.start(config);
    expect(engine.getPresenceState()).toBe("present");
    await engine.stop();
    expect(engine.getPresenceState()).toBe("unknown");
  });

  it("captureBurst() returns correct number of frames", async () => {
    const engine = new MockVisionEngine();
    const options: BurstOptions = {
      durationMs: 2000,
      fps: 5,
      reason: "test",
    };
    const frames = await engine.captureBurst(options);
    expect(frames.length).toBe(10);
  });

  it("frames contain DetectedObject with expected labels", async () => {
    const engine = new MockVisionEngine();
    const options: BurstOptions = {
      durationMs: 1000,
      fps: 2,
      reason: "test",
    };
    const frames = await engine.captureBurst(options);
    expect(frames.length).toBeGreaterThan(0);
    const firstFrame = frames[0];
    expect(firstFrame.objects.length).toBe(2);
    expect(firstFrame.objects[0].label).toBe("person");
    expect(firstFrame.objects[1].label).toBe("cup");
  });
});

describe("MockDetectionModel", () => {
  it("analyze() returns fixture objects", async () => {
    const model = new MockDetectionModel();
    const result = await model.analyze(new Uint8Array(0));
    expect(result.length).toBe(2);
    expect(result[0].label).toBe("person");
    expect(result[0].confidence).toBe(0.92);
    expect(result[0].bbox).toEqual({ x: 100, y: 100, width: 200, height: 300 });
    expect(result[1].label).toBe("cup");
    expect(result[1].confidence).toBe(0.78);
    expect(result[1].bbox).toEqual({ x: 300, y: 300, width: 50, height: 50 });
  });

  it("warmup() resolves", async () => {
    const model = new MockDetectionModel();
    await expect(model.warmup()).resolves.toBeUndefined();
  });

  it("dispose() resolves", async () => {
    const model = new MockDetectionModel();
    await expect(model.dispose()).resolves.toBeUndefined();
  });
});
