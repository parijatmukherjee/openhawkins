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

export async function verifyDurable(opts: {
  dbPath: string;
  vaultPath: string;
  passphrase: string;
  sessionId?: string;
}): Promise<{
  events: number;
  auditEntries: number;
  auditVerified: boolean;
  auditBrokenAt?: number;
  auditReason?: string;
}> {
  const db = openDatabase({ path: opts.dbPath });
  try {
    const key = await resolveAuditKey(
      new FileVault({ path: opts.vaultPath, passphrase: opts.passphrase }),
    );
    const store = new SqliteEventStore(db);
    const audit = new SqliteAuditLog(db, key);
    const events = (await store.read(opts.sessionId ?? "probe-agent-session")).length;
    const entries = await audit.entries();
    const result = await audit.verify();
    const out: {
      events: number;
      auditEntries: number;
      auditVerified: boolean;
      auditBrokenAt?: number;
      auditReason?: string;
    } = { events, auditEntries: entries.length, auditVerified: result.ok };
    if (result.brokenAt !== undefined) out.auditBrokenAt = result.brokenAt;
    if (result.reason !== undefined) out.auditReason = result.reason;
    return out;
  } finally {
    closeDriver(db);
  }
}

function closeDriver(db: SqlDriver): void {
  db.close();
}
