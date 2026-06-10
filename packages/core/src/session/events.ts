import type { PhaseEvent } from "../playbook/events.js";

export type DomainEvent =
  | { type: "SessionStarted"; sessionId: string; agentId: string; at: number }
  | { type: "TurnStarted"; sessionId: string; turnId: string; input: string; at: number }
  | { type: "TurnEnded"; sessionId: string; turnId: string; final: string; at: number }
  | { type: "TurnFailed"; sessionId: string; turnId: string; error: string; at: number }
  | PhaseEvent;

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  read(sessionId: string, opts?: { limit?: number; afterSeq?: number }): Promise<DomainEvent[]>;
}

export class InMemoryEventStore implements EventStore {
  private readonly log: DomainEvent[] = [];

  async append(event: DomainEvent): Promise<void> {
    this.log.push(event);
  }

  async read(
    sessionId: string,
    opts?: { limit?: number; afterSeq?: number },
  ): Promise<DomainEvent[]> {
    const events = this.log.filter((e) => e.sessionId === sessionId);
    let start = 0;
    if (opts?.afterSeq !== undefined) {
      start = opts.afterSeq; // afterSeq is the count of events already consumed
    }
    let end = events.length;
    if (opts?.limit !== undefined) {
      end = Math.min(start + opts.limit, events.length);
    }
    return events.slice(start, end);
  }
}
