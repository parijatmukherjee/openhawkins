import type { EventStore, DomainEvent } from "@openhawkins/core";
import { parseJsonOrThrow } from "@openhawkins/core";
import { type SqlDriver, type SqlStatement, openDatabase } from "./driver/driver.js";
import { migrate } from "./migrate.js";
import { SCHEMA } from "./schema.js";

/**
 * VINES — a durable implementation of core's `EventStore` over embedded SQLite.
 * Because the S1 `Session` writes only through `append` and rebuilds state by
 * folding `read`, swapping `InMemoryEventStore -> SqliteEventStore` is the only
 * change a caller makes; replay and single-writer integrity are unchanged.
 */
export class SqliteEventStore implements EventStore {
  private readonly db: SqlDriver;
  private readonly insertStmt: SqlStatement;

  constructor(db: SqlDriver) {
    this.db = db;
    migrate(db, SCHEMA);
    this.insertStmt = db.prepare(
      "INSERT INTO events (session_id, type, payload, at) VALUES (?, ?, ?, ?)",
    );
  }

  /** Open (or create) a database file (or ":memory:") and run migrations. */
  static open(path: string): SqliteEventStore {
    return new SqliteEventStore(openDatabase({ path }));
  }

  async append(event: DomainEvent): Promise<void> {
    this.insertStmt.run(event.sessionId, event.type, JSON.stringify(event), event.at);
  }

  async read(
    sessionId: string,
    opts?: { limit?: number; afterSeq?: number },
  ): Promise<DomainEvent[]> {
    let sql = "SELECT payload FROM events WHERE session_id = ?";
    const params: unknown[] = [sessionId];
    if (opts?.afterSeq !== undefined) {
      sql += " AND seq > ?";
      params.push(opts.afterSeq);
    }
    sql += " ORDER BY seq";
    if (opts?.limit !== undefined) {
      sql += " LIMIT ?";
      params.push(opts.limit);
    }
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as { payload: string }[];
    return rows.map((r) => parseJsonOrThrow<DomainEvent>(r.payload, "SqliteEventStore", 200));
  }

  close(): void {
    this.db.close();
  }
}
