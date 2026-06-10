import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, dirname } from "node:path";
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

describe("FileVault — durability & hardening (F-H5)", () => {
  const vaultPath = (): string => join(mkdtempSync(join(tmpdir(), "oh-vaulth-")), "secrets.json");

  it("concurrent set() calls do not drop writes (serialized mutations)", async () => {
    const path = vaultPath();
    const v = new FileVault({ path, passphrase: "pw" });
    // Fired without awaiting between them: with an unserialized read-modify-write the later
    // save() would clobber the earlier ones and only one key would survive.
    await Promise.all([v.set("a", "1"), v.set("b", "2"), v.set("c", "3")]);
    expect(await v.get("a")).toBe("1");
    expect(await v.get("b")).toBe("2");
    expect(await v.get("c")).toBe("3");
  });

  it("leaves no temp files behind after a write (atomic rename)", async () => {
    const path = vaultPath();
    await new FileVault({ path, passphrase: "pw" }).set("k", "v");
    const entries = readdirSync(dirname(path));
    expect(entries).toEqual(["secrets.json"]); // only the final file, no *.tmp-* sibling
  });

  it("records the scrypt parameters used and honors a custom cost", async () => {
    const path = vaultPath();
    // A deliberately low cost so the test is fast; the value is round-tripped and recorded.
    const v = new FileVault({ path, passphrase: "pw", scryptCost: { N: 1024, r: 8, p: 1 } });
    await v.set("k", "v");
    const onDisk = JSON.parse(readFileSync(path, "utf8")) as { scrypt?: { N: number } };
    expect(onDisk.scrypt).toEqual({ N: 1024, r: 8, p: 1 });
    expect(await new FileVault({ path, passphrase: "pw" }).get("k")).toBe("v");
  });

  it("decrypts a legacy file that has no recorded scrypt params", async () => {
    const path = vaultPath();
    // Write with the legacy default cost (N=16384), then strip the recorded params to
    // simulate a file written by the old code, and confirm a default vault still reads it.
    const legacy = new FileVault({ path, passphrase: "pw", scryptCost: { N: 16384, r: 8, p: 1 } });
    await legacy.set("k", "legacy-value");
    const file = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    delete file.scrypt;
    writeFileSync(path, JSON.stringify(file), "utf8");
    expect(await new FileVault({ path, passphrase: "pw" }).get("k")).toBe("legacy-value");
  });
});
