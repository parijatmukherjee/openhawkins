import { describe, it, expect } from "vitest";
import {
  GENESIS,
  InMemoryAuditLog,
  hashEntry,
  mintAuditKey,
  resolveAuditKey,
} from "../../src/security/audit.js";
import { InMemoryVault } from "../../src/security/vault.js";

describe("InMemoryAuditLog (Murray)", () => {
  it("chains entries and verifies a clean log", async () => {
    const log = new InMemoryAuditLog();
    await log.append({ kind: "ToolCalled", data: { tool: "disk_free" }, at: 1 });
    await log.append({ kind: "FinalAccepted", data: { final: "12345 bytes" }, at: 2 });

    const entries = await log.entries();
    expect(entries.map((e) => e.seq)).toEqual([0, 1]);
    expect(entries[1].prevHash).toBe(entries[0].hash);
    expect(await log.verify()).toBe(true);
  });

  it("verify() FAILS after a past entry is tampered with", async () => {
    const log = new InMemoryAuditLog();
    await log.append({ kind: "GroundingEvaluated", data: { accept: false }, at: 1 });
    await log.append({ kind: "FinalAccepted", data: { final: "real" }, at: 2 });

    // Tamper: rewrite history. entries() returns references to the stored entries.
    const entries = await log.entries();
    (entries[0].data as { accept: boolean }).accept = true;

    expect(await log.verify()).toBe(false);
  });

  it("redacts secrets before they enter the chained record", async () => {
    const log = new InMemoryAuditLog();
    const entry = await log.append({
      kind: "ModelRequested",
      data: { model: "gpt-oss:120b", apiKey: "sk-cloud-should-not-persist" },
      at: 1,
    });
    expect(entry.data.apiKey).toBe("[REDACTED]");
    expect(JSON.stringify(await log.entries())).not.toContain("sk-cloud-should-not-persist");
    expect(await log.verify()).toBe(true);
  });
});

describe("keyed audit chain (HMAC)", () => {
  it("a chain built under key K verifies under K", async () => {
    const key = mintAuditKey();
    const a = new InMemoryAuditLog(key);
    await a.append({ kind: "X", data: { v: 1 }, at: 1 });
    await a.append({ kind: "Y", data: { v: 2 }, at: 2 });
    expect(await a.verify()).toBe(true);
  });

  it("hashEntry is keyed: same content under different keys differs (forgery resistance)", () => {
    const e = { seq: 0, at: 1, kind: "X", data: { v: 1 } };
    const h1 = hashEntry(mintAuditKey(), GENESIS, e);
    const h2 = hashEntry(mintAuditKey(), GENESIS, e);
    expect(h1).not.toBe(h2);
  });

  it("auto-mints an ephemeral key when none is supplied (always keyed)", async () => {
    const a = new InMemoryAuditLog();
    await a.append({ kind: "Z", data: {}, at: 1 });
    expect(await a.verify()).toBe(true);
  });

  it("verify() FAILS when an entry's prevHash link is broken", async () => {
    const a = new InMemoryAuditLog();
    await a.append({ kind: "A", data: { v: 1 }, at: 1 });
    await a.append({ kind: "B", data: { v: 2 }, at: 2 });

    // Break the chain link: rewrite the second entry's prevHash.
    const entries = await a.entries();
    entries[1].prevHash = GENESIS;

    expect(await a.verify()).toBe(false);
  });

  it("mintAuditKey returns 32 random bytes", () => {
    const k = mintAuditKey();
    expect(k).toBeInstanceOf(Buffer);
    expect(k.length).toBe(32);
    expect(mintAuditKey().equals(k)).toBe(false);
  });
});

describe("resolveAuditKey", () => {
  it("mints + stores a key on first use and returns the SAME key thereafter", async () => {
    const vault = new InMemoryVault();
    const k1 = await resolveAuditKey(vault);
    expect(k1.length).toBe(32);
    const k2 = await resolveAuditKey(vault); // persisted -> identical
    expect(k2.equals(k1)).toBe(true);
  });
});
