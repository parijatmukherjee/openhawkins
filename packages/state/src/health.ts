import { openDatabase } from "./driver/driver.js";
import { FileVault } from "@openhawkins/core";
import { SqliteAuditLog } from "./audit-store.js";
import { resolveAuditKey } from "@openhawkins/core";
import { SqliteEventStore } from "./event-store.js";
import type { Logger } from "@openhawkins/core";
import { noopLogger } from "@openhawkins/core";

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

export async function checkHealth(opts: HealthOpts, logger?: Logger): Promise<HealthCheck> {
  const log = logger ?? noopLogger;
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

      const vault = new FileVault({ path: opts.vaultPath, passphrase: opts.passphrase });
      try {
        await vault.get("__health_probe__");
        vaultUnlocked = true;
      } catch (err) {
        vaultUnlocked = false;
        log.log("warn", "health_check_vault_unlock_failed", { reason: String(err) });
      }

      try {
        const key = await resolveAuditKey(vault);
        const audit = new SqliteAuditLog(db, key);
        lastAuditVerified = (await audit.verify()).ok;
      } catch (err) {
        lastAuditVerified = false;
        log.log("warn", "health_check_audit_verify_failed", { reason: String(err) });
      }

      try {
        const store = new SqliteEventStore(db);
        const allEvents = await store.read("probe-agent-session");
        const turns = allEvents.filter((e) => e.type === "TurnStarted" || e.type === "TurnFailed");
        const recent = turns.filter((e) => now - e.at <= lookback);
        const failures = recent.filter((e) => e.type === "TurnFailed").length;
        const total = recent.filter((e) => e.type === "TurnStarted").length;
        recentErrorRate = total > 0 ? failures / total : 0;
      } catch (err) {
        recentErrorRate = 0;
        log.log("warn", "health_check_event_read_failed", { reason: String(err) });
      }
    } finally {
      db.close();
    }
  } catch (err) {
    dbOk = false;
    log.log("warn", "health_check_db_open_failed", { reason: String(err) });
  }

  return { dbOk, vaultUnlocked, lastAuditVerified, recentErrorRate };
}
