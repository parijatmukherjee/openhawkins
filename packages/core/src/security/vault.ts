import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, mkdir, open, rename } from "node:fs/promises";
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

/** scrypt work parameters. Recorded in each vault file so a file written under one cost
 *  still decrypts after the default is raised. */
interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** Node's historical default cost — what files written before A6 used. A file with no
 *  recorded `scrypt` block is decrypted under these so it still opens. */
const LEGACY_SCRYPT: ScryptParams = { N: 16384, r: 8, p: 1 };

/** The raised default for newly-written vaults (4x the legacy work factor). Tunable per
 *  instance via `scryptCost`; callers wanting the OWASP 2^17 can pass it. */
const DEFAULT_SCRYPT: ScryptParams = { N: 65536, r: 8, p: 1 };

interface VaultFile {
  v: 1;
  scrypt?: ScryptParams;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

/** Derive the 32-byte AES key. `maxmem` is sized to the parameters (scrypt needs
 *  ~128*N*r bytes; the default 32 MiB ceiling is too low for a raised N), so tuning the
 *  cost never trips an opaque "memory limit exceeded". */
function deriveKey(passphrase: string, salt: Buffer, params: ScryptParams): Buffer {
  return scryptSync(passphrase, salt, 32, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * params.N * params.r * 2,
  });
}

/**
 * A passphrase-encrypted, single-file vault. The whole secret map is encrypted as one
 * AES-256-GCM blob; reads decrypt it, mutations re-encrypt it. Hardened (review F-H5):
 * writes are atomic (temp file + fsync + rename, so a crash never corrupts the live
 * vault), mutations are serialized (concurrent `set`s can't drop each other's writes),
 * and the scrypt cost is raised and recorded per file. The file is written 0600.
 */
export class FileVault implements Vault {
  private readonly path: string;
  private readonly passphrase: string;
  private readonly scrypt: ScryptParams;
  /** One-at-a-time mutation/read queue: every op chains off the previous so a read-
   *  modify-write is never interleaved with another. The same single-writer tail the
   *  session loop and the audit log use. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(opts: { path: string; passphrase: string; scryptCost?: ScryptParams }) {
    this.path = opts.path;
    this.passphrase = opts.passphrase;
    this.scrypt = opts.scryptCost ?? DEFAULT_SCRYPT;
  }

  /** Run `op` after all previously-queued ops complete; one failure does not poison the
   *  queue (the tail swallows rejections so later ops still run). */
  private serialize<T>(op: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => op());
    this.tail = run.catch(() => undefined);
    return run;
  }

  async get(key: string): Promise<string | null> {
    return this.serialize(async () => {
      const map = await this.load();
      return map[key] ?? null;
    });
  }

  async set(key: string, value: string): Promise<void> {
    return this.serialize(async () => {
      const map = await this.load();
      map[key] = value;
      await this.save(map);
    });
  }

  async delete(key: string): Promise<void> {
    return this.serialize(async () => {
      const map = await this.load();
      delete map[key];
      await this.save(map);
    });
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
    const params = file.scrypt ?? LEGACY_SCRYPT;
    const salt = Buffer.from(file.salt, "base64");
    const key = deriveKey(this.passphrase, salt, params);
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
    const key = deriveKey(this.passphrase, salt, this.scrypt);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(map), "utf8"), cipher.final()]);
    const file: VaultFile = {
      v: 1,
      scrypt: this.scrypt,
      salt: salt.toString("base64"),
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: data.toString("base64"),
    };
    await mkdir(dirname(this.path), { recursive: true });
    // Atomic replace: write the complete blob to a sibling temp file, fsync it durable,
    // then rename it over the target. A crash leaves either the intact old file or the
    // intact new one — never a truncated vault (review F-H5). We fsync the file but not the
    // directory (a dir-handle fsync isn't portable to Windows, which the CI matrix runs); a
    // post-rename power loss could lose the just-written file, but never corrupts the vault —
    // the prior committed file stays intact, so no previously-stored secret is at risk.
    const tmp = `${this.path}.tmp-${randomBytes(6).toString("hex")}`;
    const handle = await open(tmp, "w", 0o600);
    try {
      await handle.writeFile(JSON.stringify(file), "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, this.path);
  }
}
