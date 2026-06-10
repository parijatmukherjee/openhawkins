import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryAuditLog } from "../../src/security/audit.js";
import { redact, REDACTED } from "../../src/security/redact.js";
import { FileVault } from "../../src/security/vault.js";

describe("InMemoryAuditLog — chain break detection", () => {
  it("verify() fails when a prevHash link is broken", async () => {
    const log = new InMemoryAuditLog();
    await log.append({ kind: "a", data: {}, at: 1 });
    await log.append({ kind: "b", data: {}, at: 2 });
    const entries = await log.entries();
    entries[1].prevHash = "deadbeef".repeat(8);
    expect((await log.verify()).ok).toBe(false);
  });
});

describe("redact — top-level string", () => {
  it("redacts a bare secret-shaped string", () => {
    expect(redact("Bearer sk-abcdefgh12345")).toBe(REDACTED);
  });
});

describe("FileVault — delete and error paths", () => {
  const vaultPath = (): string => join(mkdtempSync(join(tmpdir(), "oh-vault-x-")), "secrets.json");

  it("deletes a stored key", async () => {
    const path = vaultPath();
    const v = new FileVault({ path, passphrase: "pw" });
    await v.set("k", "v");
    await v.delete("k");
    expect(await v.get("k")).toBeNull();
  });

  it("rethrows a non-ENOENT read error (path is a directory)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oh-vault-dir-"));
    const v = new FileVault({ path: dir, passphrase: "pw" });
    await expect(v.get("k")).rejects.toThrow();
  });
});
