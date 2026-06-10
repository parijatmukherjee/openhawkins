export interface VisionEngine {
  start(config: VisionConfig): Promise<void>;
  stop(): Promise<void>;
  captureBurst(options: BurstOptions): Promise<VisionFrame[]>;
  getPresenceState(): PresenceState;
}

export interface VisionConfig {
  pollFps: number;
  idleFps: number;
  idleTimeoutMs: number;
  burstFps: number;
  burstDurationMs: number;
  detectionConfidence: number;
}

export interface BurstOptions {
  durationMs: number;
  fps: number;
  reason: string;
}

export interface VisionFrame {
  frameId: string;
  timestamp: number;
  width: number;
  height: number;
  objects: DetectedObject[];
}

export interface DetectedObject {
  label: string;
  confidence: number;
  bbox: { x: number; y: number; width: number; height: number };
}

export type PresenceState = "unknown" | "present" | "away" | "multiple_people";
