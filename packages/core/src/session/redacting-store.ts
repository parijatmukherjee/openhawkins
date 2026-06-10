import type { EventStore, DomainEvent } from "./events.js";
import { redact } from "../security/redact.js";

/**
 * Wraps an `EventStore` so every appended event is redacted at the persistence boundary
 * (review F-C3): secrets/PII in payload fields (e.g. a user prompt's `input`, a model
 * `final`) never land in the durable store. `redact` masks by value-shape + secret
 * key-name only, so structural fields (`sessionId`, `runId`, `type`, `phase`, `at`)
 * survive — `read`/replay are unaffected. `read` is a pure pass-through.
 */
export class RedactingEventStore implements EventStore {
  constructor(private readonly inner: EventStore) {}

  async append(event: DomainEvent): Promise<void> {
    await this.inner.append(redact(event) as DomainEvent);
  }

  async read(
    sessionId: string,
    opts?: { limit?: number; afterSeq?: number },
  ): Promise<DomainEvent[]> {
    return this.inner.read(sessionId, opts);
  }
}
