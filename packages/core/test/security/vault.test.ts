import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { InMemoryVault, FileVault } from "../../src/security/vault.js";

describe("InMemoryVault", () => {
  it("stores, returns, and deletes secrets; missing key is null", async () => {
    const v = new InMemoryVault();
    expect(await v.get("k")).toBeNull();
    await v.set("k", "s3cret");
    expect(await v.get("k")).toBe("s3cret");
    await v.delete("k");
    expect(await v.get("k")).toBeNull();
  });
});

describe("FileVault (encrypted at rest)", () => {
  const vaultPath = (): string => join(mkdtempSync(join(tmpdir(), "oh-vault-")), "secrets.json");

  it("round-trips a secret through an encrypted file", async () => {
    const path = vaultPath();
    const v = new FileVault({ path, passphrase: "correct horse battery staple" });
    await v.set("OLLAMA_CLOUD_KEY", "sk-cloud-xyz");

    // A fresh instance (cold read) must decrypt the same value.
    const v2 = new FileVault({ path, passphrase: "correct horse battery staple" });
    expect(await v2.get("OLLAMA_CLOUD_KEY")).toBe("sk-cloud-xyz");
  });

  it("does not store the plaintext secret on disk", async () => {
    const path = vaultPath();
    const v = new FileVault({ path, passphrase: "pw" });
    await v.set("API_KEY", "PLAINTEXT-SECRET-VALUE");
    const onDisk = readFileSync(path, "utf8");
    expect(onDisk).not.toContain("PLAINTEXT-SECRET-VALUE");
    expect(onDisk).not.toContain("API_KEY"); // the whole map is encrypted, keys included
  });

  it("fails to decrypt with the wrong passphrase (auth tag rejects tampering)", async () => {
    const path = vaultPath();
    await new FileVault({ path, passphrase: "right" }).set("k", "v");
    await expect(new FileVault({ path, passphrase: "wrong" }).get("k")).rejects.toThrow();
  });

  it("returns null for a key in a vault file that does not exist yet", async () => {
    const v = new FileVault({ path: vaultPath(), passphrase: "pw" });
    expect(await v.get("absent")).toBeNull();
  });

  it.skipIf(platform() === "win32")("writes the vault file as 0600", async () => {
    const path = vaultPath();
    await new FileVault({ path, passphrase: "pw" }).set("k", "v");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
