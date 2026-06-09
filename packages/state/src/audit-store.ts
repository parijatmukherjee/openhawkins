import {
  type AuditLog,
  type AuditInput,
  type AuditEntry,
  hashEntry,
  redact,
  GENESIS,
} from "@openhawkins/core";
import { type SqlDriver, type SqlStatement, openDatabase } from "./driver/driver.js";
import { migrate } from "./migrate.js";
import { SCHEMA } from "./schema.js";

interface AuditRow {
  seq: number;
  at: number;
  kind: string;
  data: string;
  prev_hash: string;
  hash: string;
}

/**
 * VINES — a durable implementation of core's hash-chained `AuditLog` over embedded
 * SQLite. The chain algorithm is core's `hashEntry` over redacted data, identical to
 * `InMemoryAuditLog`, so a durable log verifies the same way. `seq`/`prevHash` are read
 * from the persisted tail (not an in-memory counter).
 *
 * Concurrency (review F-H3): appends through ONE instance are serialized by the `tail`
 * promise-chain, so the tail-read→insert critical section can't interleave and fork the
 * chain. Across SEPARATE instances over the same DB, single-writer is the contract; the
 * `seq` PRIMARY KEY only rejects a duplicate insert when two racers compute the SAME `seq`
 * (a hard error, not silent corruption), and `verify()` is the catch-all that detects any
 * cross-instance fork after the fact. The durable single-writer cutover is tracked in A1b.
 */
export class SqliteAuditLog implements AuditLog {
  private readonly db: SqlDriver;
  private readonly insertStmt: SqlStatement;
  private readonly tailStmt: SqlStatement;
  private readonly allStmt: SqlStatement;
  /** Serializes appends: each waits for the prior so tail reads never race. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(db: SqlDriver) {
    this.db = db;
    migrate(db, SCHEMA);
    this.insertStmt = db.prepare(
      "INSERT INTO audit (seq, at, kind, data, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.tailStmt = db.prepare("SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1");
    this.allStmt = db.prepare(
      "SELECT seq, at, kind, data, prev_hash, hash FROM audit ORDER BY seq",
    );
  }

  static open(path: string): SqliteAuditLog {
    return new SqliteAuditLog(openDatabase({ path }));
  }

  append(input: AuditInput): Promise<AuditEntry> {
    const run = this.tail.then(() => this.doAppend(input));
    this.tail = run.catch(() => undefined);
    return run;
  }

  private doAppend(input: AuditInput): AuditEntry {
    // `seq` is app-assigned (not AUTOINCREMENT) and gapless/monotonic only under the
    // append-only contract — the table is never deleted from; the hash chain, not the PK,
    // is the integrity mechanism.
    const tip = this.tailStmt.get() as { seq: number; hash: string } | undefined;
    const seq = tip === undefined ? 0 : tip.seq + 1;
    const prevHash = tip === undefined ? GENESIS : tip.hash;
    const data = redact(input.data) as Record<string, unknown>;
    const base = { seq, at: input.at, kind: input.kind, data };
    const hash = hashEntry(prevHash, base);
    this.insertStmt.run(seq, input.at, input.kind, JSON.stringify(data), prevHash, hash);
    return { ...base, prevHash, hash };
  }

  async entries(): Promise<AuditEntry[]> {
    return (this.allStmt.all() as AuditRow[]).map((r) => ({
      seq: r.seq,
      at: r.at,
      kind: r.kind,
      data: JSON.parse(r.data) as Record<string, unknown>,
      prevHash: r.prev_hash,
      hash: r.hash,
    }));
  }

  async verify(): Promise<boolean> {
    let prev = GENESIS;
    for (const e of await this.entries()) {
      if (e.prevHash !== prev) {
        return false;
      }
      if (e.hash !== hashEntry(prev, { seq: e.seq, at: e.at, kind: e.kind, data: e.data })) {
        return false;
      }
      prev = e.hash;
    }
    return true;
  }

  close(): void {
    this.db.close();
  }
}
