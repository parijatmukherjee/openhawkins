import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * The Cabin — secrets interface (spec §8.1). Secrets resolve at the point of use
 * and never land in config, events, or audit. S1 ships an encrypted `FileVault`
 * (AES-256-GCM, key derived from a passphrase via scrypt, file mode 0600) plus an
 * `InMemoryVault` for tests; the `KeychainVault` lands in S6 behind this same
 * interface without changing callers (decision §4).
 */
export interface Vault {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Non-persistent vault for tests and ephemeral runs. */
export class InMemoryVault implements Vault {
  private readonly store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

interface VaultFile {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

/**
 * A passphrase-encrypted, single-file vault. The whole secret map is encrypted as
 * one AES-256-GCM blob; reads/writes decrypt, mutate, and re-encrypt. The file is
 * written 0600 (owner read/write only).
 */
export class FileVault implements Vault {
  private readonly path: string;
  private readonly passphrase: string;

  constructor(opts: { path: string; passphrase: string }) {
    this.path = opts.path;
    this.passphrase = opts.passphrase;
  }

  async get(key: string): Promise<string | null> {
    const map = await this.load();
    return map[key] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const map = await this.load();
    map[key] = value;
    await this.save(map);
  }

  async delete(key: string): Promise<void> {
    const map = await this.load();
    delete map[key];
    await this.save(map);
  }

  private async load(): Promise<Record<string, string>> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (err) {
      // A missing vault is an empty vault; anything else is a real failure.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }
      throw err;
    }
    const file = JSON.parse(raw) as VaultFile;
    const salt = Buffer.from(file.salt, "base64");
    const key = scryptSync(this.passphrase, salt, 32);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(file.iv, "base64"));
    decipher.setAuthTag(Buffer.from(file.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(file.data, "base64")),
      decipher.final(),
    ]);
    return JSON.parse(plain.toString("utf8")) as Record<string, string>;
  }

  private async save(map: Record<string, string>): Promise<void> {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = scryptSync(this.passphrase, salt, 32);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(map), "utf8"), cipher.final()]);
    const file: VaultFile = {
      v: 1,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(file), { encoding: "utf8", mode: 0o600 });
  }
}
