import { describe, it, expect } from "vitest";
import {
  GENESIS,
  InMemoryAuditLog,
  hashEntry,
  mintAuditKey,
  resolveAuditKey,
  rotateAuditKey,
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
    const result = await log.verify();
    expect(result.ok).toBe(true);
    expect(result.brokenAt).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });

  it("verify() fails after a past entry is tampered with and reports brokenAt + reason", async () => {
    const log = new InMemoryAuditLog();
    await log.append({ kind: "GroundingEvaluated", data: { accept: false }, at: 1 });
    await log.append({ kind: "FinalAccepted", data: { final: "real" }, at: 2 });

    // Tamper: rewrite history. entries() returns references to the stored entries.
    const entries = await log.entries();
    (entries[0].data as { accept: boolean }).accept = true;

    const result = await log.verify();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(0);
    expect(result.reason).toContain("hash mismatch");
    expect(result.reason).toContain("seq 0");
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
    const result = await log.verify();
    expect(result.ok).toBe(true);
  });
});

describe("keyed audit chain (HMAC)", () => {
  it("a chain built under key K verifies under K", async () => {
    const key = mintAuditKey();
    const a = new InMemoryAuditLog(key);
    await a.append({ kind: "X", data: { v: 1 }, at: 1 });
    await a.append({ kind: "Y", data: { v: 2 }, at: 2 });
    const result = await a.verify();
    expect(result.ok).toBe(true);
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
    const result = await a.verify();
    expect(result.ok).toBe(true);
  });

  it("verify() fails when an entry's prevHash link is broken and reports the break", async () => {
    const a = new InMemoryAuditLog();
    await a.append({ kind: "A", data: { v: 1 }, at: 1 });
    await a.append({ kind: "B", data: { v: 2 }, at: 2 });

    // Break the chain link: rewrite the second entry's prevHash.
    const entries = await a.entries();
    entries[1].prevHash = GENESIS;

    const result = await a.verify();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toContain("prevHash mismatch");
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

describe("rotateAuditKey", () => {
  it("re-keys a chain so it verifies under the new key", async () => {
    const oldKey = mintAuditKey();
    const log = new InMemoryAuditLog(oldKey);
    await log.append({ kind: "A", data: { v: 1 }, at: 1 });
    await log.append({ kind: "B", data: { v: 2 }, at: 2 });
    const entries = await log.entries();
    const newKey = mintAuditKey();
    const rotated = rotateAuditKey(oldKey, newKey, entries);

    // Rotated entries verify under the new key
    const rotatedLog = new InMemoryAuditLog(newKey);
    for (const e of rotated) {
      await rotatedLog.append({ kind: e.kind, data: e.data, at: e.at });
    }
    const result = await rotatedLog.verify();
    expect(result.ok).toBe(true);
  });

  it("re-keys produce identical seq/at/kind/data and different hashes", async () => {
    const oldKey = mintAuditKey();
    const log = new InMemoryAuditLog(oldKey);
    await log.append({ kind: "A", data: { v: 1 }, at: 1 });
    await log.append({ kind: "B", data: { v: 2 }, at: 2 });
    const entries = await log.entries();
    const newKey = mintAuditKey();
    const rotated = rotateAuditKey(oldKey, newKey, entries);

    for (let i = 0; i < entries.length; i++) {
      expect(rotated[i].seq).toBe(entries[i].seq);
      expect(rotated[i].at).toBe(entries[i].at);
      expect(rotated[i].kind).toBe(entries[i].kind);
      expect(rotated[i].data).toEqual(entries[i].data);
      expect(rotated[i].hash).not.toBe(entries[i].hash);
    }
  });

  it("throws if the old chain does not verify (hash mismatch)", async () => {
    const oldKey = mintAuditKey();
    const log = new InMemoryAuditLog(oldKey);
    await log.append({ kind: "A", data: { v: 1 }, at: 1 });
    const entries = await log.entries();
    entries[0].hash = "deadbeef".repeat(8);

    const newKey = mintAuditKey();
    expect(() => rotateAuditKey(oldKey, newKey, entries)).toThrow("chain broken at seq 0");
  });

  it("throws if the old chain prevHash link is broken during rotation", async () => {
    const oldKey = mintAuditKey();
    const log = new InMemoryAuditLog(oldKey);
    await log.append({ kind: "A", data: { v: 1 }, at: 1 });
    await log.append({ kind: "B", data: { v: 2 }, at: 2 });
    const entries = await log.entries();
    entries[1].prevHash = GENESIS; // break the prevHash link

    const newKey = mintAuditKey();
    expect(() => rotateAuditKey(oldKey, newKey, entries)).toThrow("chain broken at seq 1");
  });

  it("empty chain returns empty array", () => {
    const oldKey = mintAuditKey();
    const newKey = mintAuditKey();
    const rotated = rotateAuditKey(oldKey, newKey, []);
    expect(rotated).toEqual([]);
  });

  it("rotated chain links correctly (prevHash continuity)", async () => {
    const oldKey = mintAuditKey();
    const log = new InMemoryAuditLog(oldKey);
    await log.append({ kind: "A", data: { v: 1 }, at: 1 });
    await log.append({ kind: "B", data: { v: 2 }, at: 2 });
    const entries = await log.entries();
    const newKey = mintAuditKey();
    const rotated = rotateAuditKey(oldKey, newKey, entries);

    expect(rotated[0].prevHash).toBe(GENESIS);
    expect(rotated[1].prevHash).toBe(rotated[0].hash);
  });
});
