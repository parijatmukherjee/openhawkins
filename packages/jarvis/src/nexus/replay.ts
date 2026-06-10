import type { EventBus } from "../event-bus/simple.js";
import type { NexusEvent } from "./events.js";

export class ReplayEngine {
  private eventLog: Map<string, Array<{ event: NexusEvent; index: number }>> = new Map();
  private sequence = 0;

  constructor(eventBus: EventBus) {
    eventBus.subscribe("nexus", (event) => {
      const payload = event.payload as NexusEvent;
      const sessionId = (payload as { sessionId: string }).sessionId;
      if (!this.eventLog.has(sessionId)) {
        this.eventLog.set(sessionId, []);
      }
      this.eventLog.get(sessionId)!.push({ event: payload, index: this.sequence++ });
    });
  }

  async replay(sessionId: string): Promise<NexusEvent[]> {
    const log = this.eventLog.get(sessionId) ?? [];
    return log.map((entry) => entry.event);
  }

  async replayFrom(sessionId: string, fromIndex: number): Promise<NexusEvent[]> {
    const log = this.eventLog.get(sessionId) ?? [];
    return log.filter((entry) => entry.index >= fromIndex).map((entry) => entry.event);
  }
}
