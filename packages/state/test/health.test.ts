import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkHealth } from "../src/health.js";
import { openDatabase } from "../src/driver/driver.js";
import { SqliteAuditLog } from "../src/audit-store.js";
import { resolveAuditKey, FileVault } from "@openhawkins/core";
import type { Logger } from "@openhawkins/core";

describe("checkHealth", () => {
  it("reports healthy on a clean empty db+vault", async () => {
    const d = mkdtempSync(join(tmpdir(), "oh-health-"));
    const result = await checkHealth({
      dbPath: join(d, "health.db"),
      vaultPath: join(d, "vault.json"),
      passphrase: "test",
    });
    expect(result.dbOk).toBe(true);
    expect(result.vaultUnlocked).toBe(true);
    expect(result.lastAuditVerified).toBe(true);
    expect(result.recentErrorRate).toBe(0);
  });

  it("reports dbOk false when path is a directory (cannot open as db)", async () => {
    const d = mkdtempSync(join(tmpdir(), "oh-health-"));
    const dirPath = join(d, "notadb");
    mkdirSync(dirPath);
    const result = await checkHealth({
      dbPath: dirPath,
      vaultPath: join(d, "vault.json"),
      passphrase: "test",
    });
    expect(result.dbOk).toBe(false);
  });

  it("reports vaultUnlocked false with wrong passphrase", async () => {
    const d = mkdtempSync(join(tmpdir(), "oh-health-"));
    // Create a vault with one passphrase
    await checkHealth({
      dbPath: join(d, "health.db"),
      vaultPath: join(d, "vault.json"),
      passphrase: "correct",
    });
    // Reopen with wrong passphrase
    const result = await checkHealth({
      dbPath: join(d, "health2.db"),
      vaultPath: join(d, "vault.json"),
      passphrase: "wrong",
    });
    expect(result.vaultUnlocked).toBe(false);
  });

  it("logs root cause when vault check fails", async () => {
    const logs: { level: string; event: string; reason: string }[] = [];
    const logger: Logger = {
      log(level, event, fields) {
        logs.push({ level, event, reason: String(fields?.reason ?? "") });
      },
    };
    const d = mkdtempSync(join(tmpdir(), "oh-health-"));
    await checkHealth({
      dbPath: join(d, "health.db"),
      vaultPath: join(d, "vault.json"),
      passphrase: "correct",
    });
    const result = await checkHealth(
      {
        dbPath: join(d, "health2.db"),
        vaultPath: join(d, "vault.json"),
        passphrase: "wrong",
      },
      logger,
    );
    expect(result.vaultUnlocked).toBe(false);
    const warn = logs.find((l) => l.level === "warn" && l.event.startsWith("health_check_"));
    expect(warn).toBeDefined();
    expect(warn!.reason.length).toBeGreaterThan(0);
  });

  it("reports lastAuditVerified false when chain is tampered", async () => {
    const d = mkdtempSync(join(tmpdir(), "oh-health-"));
    const dbPath = join(d, "health.db");
    const vaultPath = join(d, "vault.json");

    // First: create vault + db + one audit entry
    const vault = new FileVault({ path: vaultPath, passphrase: "test" });
    const key = await resolveAuditKey(vault);
    const db = openDatabase({ path: dbPath });
    const audit = new SqliteAuditLog(db, key);
    await audit.append({ kind: "Test", data: { v: 1 }, at: 1 });
    db.close();

    // Tamper the entry
    const db2 = openDatabase({ path: dbPath });
    db2.prepare("UPDATE audit SET data = ? WHERE seq = 0").run(JSON.stringify({ tampered: true }));
    db2.close();

    const result = await checkHealth({
      dbPath,
      vaultPath,
      passphrase: "test",
    });
    expect(result.lastAuditVerified).toBe(false);
  });

  it("reports non-zero error rate when recent failures exist", async () => {
    const d = mkdtempSync(join(tmpdir(), "oh-health-"));
    const dbPath = join(d, "health.db");

    const { SqliteEventStore } = await import("../src/event-store.js");
    const db = openDatabase({ path: dbPath });
    const store = new SqliteEventStore(db);
    const now = Date.now();
    await store.append({
      type: "TurnStarted",
      sessionId: "probe-agent-session",
      turnId: "t1",
      input: "hi",
      at: now,
    });
    await store.append({
      type: "TurnFailed",
      sessionId: "probe-agent-session",
      turnId: "t1",
      error: "boom",
      at: now,
    });
    await store.append({
      type: "TurnStarted",
      sessionId: "probe-agent-session",
      turnId: "t2",
      input: "hi",
      at: now,
    });
    db.close();

    const result = await checkHealth({
      dbPath,
      vaultPath: join(d, "vault.json"),
      passphrase: "test",
    });
    expect(result.recentErrorRate).toBe(0.5);
  });
});
