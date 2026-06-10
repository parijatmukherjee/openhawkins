import {
  type AuditLog,
  type AuditInput,
  type AuditEntry,
  type AuditVerifyResult,
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
 * Keying (F-C2): the chain is an HMAC under a caller-supplied PERSISTENT `key`, so it is
 * tamper-proof against anyone without that key (an attacker who edits a row can't forge a
 * matching hash). The key is durable state owned by the caller, NOT derived per-instance:
 * a reopened log MUST be given the SAME key to verify a chain written earlier under it.
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
  private readonly key: Buffer;
  private readonly insertStmt: SqlStatement;
  private readonly tailStmt: SqlStatement;
  private readonly allStmt: SqlStatement;
  /** Serializes appends: each waits for the prior so tail reads never race. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(db: SqlDriver, key: Buffer) {
    this.db = db;
    this.key = key;
    migrate(db, SCHEMA);
    this.insertStmt = db.prepare(
      "INSERT INTO audit (seq, at, kind, data, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.tailStmt = db.prepare("SELECT seq, hash FROM audit ORDER BY seq DESC LIMIT 1");
    this.allStmt = db.prepare(
      "SELECT seq, at, kind, data, prev_hash, hash FROM audit ORDER BY seq",
    );
  }

  static open(path: string, key: Buffer): SqliteAuditLog {
    return new SqliteAuditLog(openDatabase({ path }), key);
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
    const hash = hashEntry(this.key, prevHash, base);
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

  /**
   * Returns an `AuditVerifyResult` with per-entry diagnostics. An `ok: false` result tells
   * exactly which `seq` failed and why (broken prevHash link or HMAC mismatch). Reopening
   * with the wrong key still yields `ok: false`, but the `reason` now says "hash mismatch",
   * making it distinguishable from structural chain breaks.
   */
  async verify(): Promise<AuditVerifyResult> {
    let prev = GENESIS;
    for (const e of await this.entries()) {
      if (e.prevHash !== prev) {
        return {
          ok: false,
          brokenAt: e.seq,
          reason: `prevHash mismatch at seq ${e.seq}: expected ${prev.slice(0, 16)}..., got ${e.prevHash.slice(0, 16)}...`,
        };
      }
      if (
        e.hash !== hashEntry(this.key, prev, { seq: e.seq, at: e.at, kind: e.kind, data: e.data })
      ) {
        return {
          ok: false,
          brokenAt: e.seq,
          reason: `hash mismatch at seq ${e.seq}: entry hash does not match HMAC-SHA256(key, prevHash + canonical)`,
        };
      }
      prev = e.hash;
    }
    return { ok: true };
  }

  close(): void {
    this.db.close();
  }
}
