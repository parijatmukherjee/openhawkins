export interface ProcessEvent {
  id: string;
  type: "phase-started" | "phase-completed" | "phase-failed" | "gate-passed" | "gate-failed";
  phaseId: string;
  timestamp: number;
  data?: unknown;
}

export class ProcessEventBus {
  private listeners: Map<string, Array<(event: ProcessEvent) => void>> = new Map();
  private eventLog: ProcessEvent[] = [];

  on(type: string, handler: (event: ProcessEvent) => void): () => void {
    const list = this.listeners.get(type) ?? [];
    list.push(handler);
    this.listeners.set(type, list);
    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  emit(event: ProcessEvent): void {
    this.eventLog.push(event);
    const list = this.listeners.get(event.type) ?? [];
    for (const handler of list) handler(event);
  }

  replay(type?: string): ProcessEvent[] {
    if (type) {
      return this.eventLog.filter((e) => e.type === type);
    }
    return [...this.eventLog];
  }

  clear(): void {
    this.eventLog = [];
    this.listeners.clear();
  }
}
