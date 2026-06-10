import { openDatabase } from "./driver/driver.js";
import { FileVault } from "@openhawkins/core";
import { SqliteAuditLog } from "./audit-store.js";
import { resolveAuditKey } from "@openhawkins/core";
import { SqliteEventStore } from "./event-store.js";

export interface HealthCheck {
  dbOk: boolean;
  vaultUnlocked: boolean;
  lastAuditVerified: boolean;
  recentErrorRate: number;
}

export interface HealthOpts {
  dbPath: string;
  vaultPath: string;
  passphrase: string;
  lookbackMs?: number;
}

/**
 * Check the health of the durable runtime: DB connectivity, vault unlock status,
 * whether the last audit chain still verifies, and the recent error rate (turn
 * failures / total turns within the lookback window).
 */
export async function checkHealth(opts: HealthOpts): Promise<HealthCheck> {
  let dbOk = false;
  let vaultUnlocked = false;
  let lastAuditVerified = false;
  let recentErrorRate = 0;

  const lookback = opts.lookbackMs ?? 60_000;
  const now = Date.now();

  try {
    const db = openDatabase({ path: opts.dbPath });
    try {
      dbOk = true;

      // Vault: instantiate + try to read a key to prove it unlocks
      const vault = new FileVault({ path: opts.vaultPath, passphrase: opts.passphrase });
      try {
        await vault.get("__health_probe__"); // may return null; that's fine
        vaultUnlocked = true;
      } catch {
        vaultUnlocked = false;
      }

      // Audit: verify chain
      try {
        const key = await resolveAuditKey(vault);
        const audit = new SqliteAuditLog(db, key);
        lastAuditVerified = await audit.verify();
      } catch {
        lastAuditVerified = false;
      }

      // Error rate: count TurnFailed events in lookback window
      try {
        const store = new SqliteEventStore(db);
        const allEvents = await store.read("probe-agent-session");
        const turns = allEvents.filter((e) => e.type === "TurnStarted" || e.type === "TurnFailed");
        const recent = turns.filter((e) => now - e.at <= lookback);
        const failures = recent.filter((e) => e.type === "TurnFailed").length;
        const total = recent.filter((e) => e.type === "TurnStarted").length;
        recentErrorRate = total > 0 ? failures / total : 0;
      } catch {
        recentErrorRate = 0;
      }
    } finally {
      db.close();
    }
  } catch {
    dbOk = false;
  }

  return { dbOk, vaultUnlocked, lastAuditVerified, recentErrorRate };
}
