import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptedOperator, weakHostFactsModel, ValidateGate } from "@openhawkins/core";
import { buildDurableAgentRun, verifyDurable } from "../src/build-durable-agent-run.js";

const dir = () => mkdtempSync(join(tmpdir(), "oh-a1b-"));
const approvals = () =>
  new ScriptedOperator(
    Array.from({ length: 8 }, () => ({ approve: true as const, actor: "op", reason: "ok" })),
  );

describe("buildDurableAgentRun + verifyDurable", () => {
  it("persists a run to SQLite with a Vault-keyed audit; a fresh reopen verifies", async () => {
    const d = dir();
    const dbPath = join(d, "run.db");
    const vaultPath = join(d, "vault.json");
    const passphrase = "test-pass";

    const built = await buildDurableAgentRun({
      dbPath,
      vaultPath,
      passphrase,
      adapter: weakHostFactsModel(tmpdir()),
      grounding: "cited",
      prompts: { Execute: "How much disk space is free on this machine?" },
      operator: approvals(),
      validateGate: new ValidateGate(async () => ({ ok: true })),
    });
    expect(await built.run.run()).toEqual({ kind: "completed" });
    expect((await built.audit.verify()).ok).toBe(true);
    built.close();

    const v = await verifyDurable({ dbPath, vaultPath, passphrase });
    expect(v.auditVerified).toBe(true);
    expect(v.events).toBeGreaterThan(0);
    expect(v.auditEntries).toBeGreaterThan(6);
  });

  it("verifyDurable reports a clean (empty) db as verified with zero entries", async () => {
    const d = dir();
    const v = await verifyDurable({
      dbPath: join(d, "empty.db"),
      vaultPath: join(d, "vault.json"),
      passphrase: "p",
    });
    expect(v).toEqual({ events: 0, auditEntries: 0, auditVerified: true });
  });

  it("verifyDurable returns brokenAt and reason when audit is tampered", async () => {
    const d = dir();
    const dbPath = join(d, "run.db");
    const vaultPath = join(d, "vault.json");
    const passphrase = "test-pass";

    // First build a valid run
    const built = await buildDurableAgentRun({
      dbPath,
      vaultPath,
      passphrase,
      adapter: weakHostFactsModel(tmpdir()),
      grounding: "cited",
      prompts: { Execute: "How much disk space is free on this machine?" },
      operator: approvals(),
      validateGate: new ValidateGate(async () => ({ ok: true })),
    });
    await built.run.run();
    built.close();

    // Tamper the audit entry
    const { openDatabase } = await import("../src/driver/driver.js");
    const db = openDatabase({ path: dbPath });
    db.prepare("UPDATE audit SET data = ? WHERE seq = 0").run(JSON.stringify({ tampered: true }));
    db.close();

    const v = await verifyDurable({ dbPath, vaultPath, passphrase });
    expect(v.auditVerified).toBe(false);
    expect(v.auditBrokenAt).toBeDefined();
    expect(v.auditReason).toBeDefined();
  });
});
