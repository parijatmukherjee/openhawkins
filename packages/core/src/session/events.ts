export type DomainEvent =
  | { type: "SessionStarted"; sessionId: string; agentId: string; at: number }
  | { type: "TurnStarted"; sessionId: string; turnId: string; input: string; at: number }
  | { type: "TurnEnded"; sessionId: string; turnId: string; final: string; at: number };

export interface EventStore {
  append(event: DomainEvent): Promise<void>;
  read(sessionId: string): Promise<DomainEvent[]>;
}

export class InMemoryEventStore implements EventStore {
  private readonly log: DomainEvent[] = [];

  async append(event: DomainEvent): Promise<void> {
    this.log.push(event);
  }

  async read(sessionId: string): Promise<DomainEvent[]> {
    return this.log.filter((e) => e.sessionId === sessionId);
  }
}
