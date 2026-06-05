import { type EventStore, type DomainEvent } from "./events.js";
import { type SessionState, reduceEvent, initialState } from "./state.js";
import { type Clock, systemClock } from "../util/clock.js";
import { createIdFactory, type IdFactory } from "../util/ids.js";

export interface SessionDeps {
  sessionId: string;
  agentId: string;
  store: EventStore;
  clock?: Clock;
}

export class Session {
  private _state: SessionState = initialState();
  private tail: Promise<unknown> = Promise.resolve();
  private readonly nextTurnId: IdFactory;

  private constructor(
    private readonly sessionId: string,
    private readonly store: EventStore,
    private readonly clock: Clock,
  ) {
    this.nextTurnId = createIdFactory(`${sessionId}-turn`);
  }

  static async start(deps: SessionDeps): Promise<Session> {
    const session = new Session(deps.sessionId, deps.store, deps.clock ?? systemClock);
    await session.commit({
      type: "SessionStarted",
      sessionId: deps.sessionId,
      agentId: deps.agentId,
      at: session.clock(),
    });
    return session;
  }

  get state(): SessionState {
    return this._state;
  }

  /** Serialized: each call runs only after the previous one fully settles. */
  runTurn(input: string, handler: () => Promise<string>): Promise<void> {
    const run = this.tail.then(() => this.doRunTurn(input, handler));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private async doRunTurn(input: string, handler: () => Promise<string>): Promise<void> {
    const turnId = this.nextTurnId();
    await this.commit({
      type: "TurnStarted",
      sessionId: this.sessionId,
      turnId,
      input,
      at: this.clock(),
    });
    const final = await handler();
    await this.commit({
      type: "TurnEnded",
      sessionId: this.sessionId,
      turnId,
      final,
      at: this.clock(),
    });
  }

  private async commit(event: DomainEvent): Promise<void> {
    await this.store.append(event);
    this._state = reduceEvent(this._state, event);
  }
}
