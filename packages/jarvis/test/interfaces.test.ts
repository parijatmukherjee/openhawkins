import { describe, it, expectTypeOf } from "vitest";
import type {
  IntentParser,
  Intent,
  JarvisContext,
  Delegator,
  AgentResult,
  AgentPool,
  AgentHandle,
  AgentInfo,
  AgentConfig,
  Synthesizer,
  Synthesis,
  VisualCommand,
  Persona,
  VoiceProfile,
  WakeWordEngine,
  SttEngine,
  TtsEngine,
  AudioInput,
  AudioOutput,
  DisplayManager,
  DisplayInfo,
  Scheduler,
  ScheduledJob,
  EventBus,
  BusEvent,
  Subscription,
  VisionEngine,
  VisionConfig,
  BurstOptions,
  VisionFrame,
  DetectedObject,
  PresenceState,
  DetectionModel,
} from "../src/index.js";

describe("jarvis interface compilation", () => {
  it("IntentParser compiles", () => {
    expectTypeOf<IntentParser>().toBeObject();
  });

  it("Intent compiles", () => {
    expectTypeOf<Intent>().toBeObject();
  });

  it("JarvisContext compiles", () => {
    expectTypeOf<JarvisContext>().toBeObject();
  });

  it("Delegator compiles", () => {
    expectTypeOf<Delegator>().toBeObject();
  });

  it("AgentResult compiles", () => {
    expectTypeOf<AgentResult>().toBeObject();
  });

  it("AgentPool compiles", () => {
    expectTypeOf<AgentPool>().toBeObject();
  });

  it("AgentHandle compiles", () => {
    expectTypeOf<AgentHandle>().toBeObject();
  });

  it("AgentInfo compiles", () => {
    expectTypeOf<AgentInfo>().toBeObject();
  });

  it("AgentConfig compiles", () => {
    expectTypeOf<AgentConfig>().toBeObject();
  });

  it("Synthesizer compiles", () => {
    expectTypeOf<Synthesizer>().toBeObject();
  });

  it("Synthesis compiles", () => {
    expectTypeOf<Synthesis>().toBeObject();
  });

  it("VisualCommand compiles", () => {
    expectTypeOf<VisualCommand>().toBeObject();
  });

  it("Persona compiles", () => {
    expectTypeOf<Persona>().toBeObject();
  });

  it("VoiceProfile compiles", () => {
    expectTypeOf<VoiceProfile>().toBeObject();
  });

  it("WakeWordEngine compiles", () => {
    expectTypeOf<WakeWordEngine>().toBeObject();
  });

  it("SttEngine compiles", () => {
    expectTypeOf<SttEngine>().toBeObject();
  });

  it("TtsEngine compiles", () => {
    expectTypeOf<TtsEngine>().toBeObject();
  });

  it("AudioInput compiles", () => {
    expectTypeOf<AudioInput>().toBeObject();
  });

  it("AudioOutput compiles", () => {
    expectTypeOf<AudioOutput>().toBeObject();
  });

  it("DisplayManager compiles", () => {
    expectTypeOf<DisplayManager>().toBeObject();
  });

  it("DisplayInfo compiles", () => {
    expectTypeOf<DisplayInfo>().toBeObject();
  });

  it("Scheduler compiles", () => {
    expectTypeOf<Scheduler>().toBeObject();
  });

  it("ScheduledJob compiles", () => {
    expectTypeOf<ScheduledJob>().toBeObject();
  });

  it("EventBus compiles", () => {
    expectTypeOf<EventBus>().toBeObject();
  });

  it("BusEvent compiles", () => {
    expectTypeOf<BusEvent>().toBeObject();
  });

  it("Subscription compiles", () => {
    expectTypeOf<Subscription>().toBeObject();
  });

  it("VisionEngine compiles", () => {
    expectTypeOf<VisionEngine>().toBeObject();
  });

  it("VisionConfig compiles", () => {
    expectTypeOf<VisionConfig>().toBeObject();
  });

  it("BurstOptions compiles", () => {
    expectTypeOf<BurstOptions>().toBeObject();
  });

  it("VisionFrame compiles", () => {
    expectTypeOf<VisionFrame>().toBeObject();
  });

  it("DetectedObject compiles", () => {
    expectTypeOf<DetectedObject>().toBeObject();
  });

  it("PresenceState compiles", () => {
    expectTypeOf<PresenceState>().toBeString();
  });

  it("DetectionModel compiles", () => {
    expectTypeOf<DetectionModel>().toBeObject();
  });
});
