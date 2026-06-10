import type { VisualCommand } from "../synthesis.js";
import type { VisionEvent } from "../vision/events.js";
import type { BusEvent } from "../event-bus.js";
import type { AuditEntry } from "@openhawkins/core";

export interface JarvisHub {
  wakeWordEngine: { start(callback: () => void): Promise<void> };
  sttEngine: { transcribe(text: string): Promise<void> };
  ttsEngine: { getLastOutput(): string };
  displayManager: { getCommands(): VisualCommand[] };
  visionEngine: { getEvents(): VisionEvent[] };
  eventBus: { getEvents(): BusEvent[] };
  auditLog: { getEntries(): AuditEntry[] };
}

export class MockUser {
  constructor(private hub: JarvisHub) {}

  async wake(): Promise<void> {
    await this.hub.wakeWordEngine.start(() => {});
  }

  async say(text: string): Promise<void> {
    await this.hub.sttEngine.transcribe(text);
  }

  listen(): string {
    return this.hub.ttsEngine.getLastOutput();
  }

  seeScreen(): VisualCommand[] {
    return this.hub.displayManager.getCommands();
  }

  seeVision(): VisionEvent[] {
    return this.hub.visionEngine.getEvents();
  }

  getEvents(): BusEvent[] {
    return this.hub.eventBus.getEvents();
  }

  getAudit(): AuditEntry[] {
    return this.hub.auditLog.getEntries();
  }
}
