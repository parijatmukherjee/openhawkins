import {
  buildAgentRun,
  resolveAuditKey,
  FileVault,
  type BuildAgentRunOpts,
  type BuiltAgentRun,
  type DocumentConverter,
} from "@openhawkins/core";
import { markdownify } from "@openhawkins/markdownify";
import { openDatabase, type SqlDriver } from "./driver/driver.js";
import { SqliteEventStore } from "./event-store.js";
import { SqliteAuditLog } from "./audit-store.js";

/** Markdownify-backed document converter injected into the agent path. */
const markdownifyConverter: DocumentConverter = {
  convert: async (data, mime, filename) => {
    const result = await markdownify({ data, mime, filename });
    return { markdown: result.markdown, format: result.format };
  },
};

/** Options for a durable agent run: the SQLite + Vault paths, plus the usual run opts
 *  (minus `store`/`audit`, which this wires). */
export interface DurableAgentRunOpts extends Omit<BuildAgentRunOpts, "store" | "audit"> {
  dbPath: string;
  vaultPath: string;
  passphrase: string;
}

/** A built durable run; `close()` releases the SQLite handle. */
export interface BuiltDurableAgentRun extends BuiltAgentRun {
  close(): void;
}

/**
 * The durable composition root (F-C1/F-C2 at runtime): one SQLite db holds the event
 * store AND the keyed audit; the audit HMAC key is resolved from a `FileVault` (minted on
 * first use). This package may import both `core` and `state` (state depends on core), so
 * the wiring `core` itself cannot do (cycle) lives here.
 */
export async function buildDurableAgentRun(
  opts: DurableAgentRunOpts,
): Promise<BuiltDurableAgentRun> {
  const { dbPath, vaultPath, passphrase, ...runOpts } = opts;
  const db = openDatabase({ path: dbPath });
  const key = await resolveAuditKey(new FileVault({ path: vaultPath, passphrase }));
  const store = new SqliteEventStore(db);
  const audit = new SqliteAuditLog(db, key);
  const built = await buildAgentRun({
    ...runOpts,
    store,
    audit,
    documentConverter: markdownifyConverter,
  });
  return { ...built, close: () => closeDriver(db) };
}

/** Reopen an existing durable db + vault and report its event count, audit size, and
 *  whether the keyed audit chain verifies — the cross-process durability proof. */
export async function verifyDurable(opts: {
  dbPath: string;
  vaultPath: string;
  passphrase: string;
  sessionId?: string;
}): Promise<{ events: number; auditEntries: number; auditVerified: boolean }> {
  const db = openDatabase({ path: opts.dbPath });
  try {
    const key = await resolveAuditKey(
      new FileVault({ path: opts.vaultPath, passphrase: opts.passphrase }),
    );
    const store = new SqliteEventStore(db);
    const audit = new SqliteAuditLog(db, key);
    const events = (await store.read(opts.sessionId ?? "probe-agent-session")).length;
    const entries = await audit.entries();
    return { events, auditEntries: entries.length, auditVerified: await audit.verify() };
  } finally {
    closeDriver(db);
  }
}

function closeDriver(db: SqlDriver): void {
  db.close();
}
