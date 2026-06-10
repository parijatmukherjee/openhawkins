import type { AgentResult } from "@openhawkins/jarvis";
import type { DetectedObject, PresenceState } from "@openhawkins/jarvis";

export interface VisionAgent {
  execute(intent: VisionIntent, context: VisionContext): Promise<VisionAgentResult>;
}

export interface VisionIntent {
  action: "vision_query" | "vision_count" | "vision_presence";
  params: Record<string, unknown>;
}

export interface VisionContext {
  sessionId: string;
  presenceState: PresenceState;
}

export interface VisionAgentResult extends AgentResult {
  output: {
    summary: string;
    objects: DetectedObject[];
    presence: PresenceState;
  };
}

export class MockVisionAgent implements VisionAgent {
  async execute(intent: VisionIntent, context: VisionContext): Promise<VisionAgentResult> {
    const objects: DetectedObject[] = [
      { label: "person", confidence: 0.92, bbox: { x: 100, y: 100, width: 200, height: 300 } },
    ];

    let summary: string;
    switch (intent.action) {
      case "vision_query":
        summary = "I see a person and a coffee mug";
        break;
      case "vision_count": {
        const label = (intent.params.label as string) || "person";
        const count = objects.filter((o) => o.label === label).length;
        summary = `I see ${count} ${label}${count !== 1 ? "s" : ""}`;
        break;
      }
      case "vision_presence":
        summary = context.presenceState === "present" ? "Yes, I see someone." : "No one is here.";
        break;
      default:
        summary = "I don't know what to look for.";
    }

    return {
      agentId: "vision",
      agentName: "VisionAgent",
      output: { summary, objects, presence: context.presenceState },
      success: true,
      auditEntry: {} as any, // Placeholder
    };
  }
}
