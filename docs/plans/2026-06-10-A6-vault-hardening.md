# A6 — Vault durability + security (F-H5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `FileVault` crash-safe and concurrency-safe, and raise its key-derivation cost, closing the data-loss and weak-KDF parts of review finding **F-H5**.

**Architecture:** Three independent hardenings to `packages/core/src/security/vault.ts`, all behind the unchanged `Vault` interface:

1. **Atomic writes.** Today `save()` `writeFile`s the whole encrypted blob straight onto the live path — a crash mid-write truncates the file and makes _every_ secret unrecoverable. Fix: write the new blob to a sibling temp file, `fsync` it, then `rename` it over the target. POSIX `rename` is atomic, so a reader (or a crash) ever sees either the complete old file or the complete new file — never a half-written one. The previously-committed secrets are never at risk.
2. **Serialized mutations.** `set`/`delete` are read-modify-write (`load()` the whole map, mutate, `save()`); two concurrent `set`s both load the old map and the second `save` clobbers the first's write (a lost secret). Fix: funnel every operation through a single promise-chain `tail` so they run one-at-a-time in call order — the same pattern the keyed audit log (A2) uses.
3. **Tunable, raised scrypt cost.** `scryptSync(pass, salt, 32)` uses Node's default cost (N=16384). Fix: derive with explicit, raised parameters (default N=65536), make them a constructor option, and record the parameters used in the vault file so older files (written without them) still decrypt under the legacy default — a file written by old code reads back, and is upgraded to the new cost on its next save.

**Scope note (honest):** This PR hardens the `FileVault` itself. The other half of F-H5 — "CLIs read adapter keys from `process.env` instead of the Vault" (`bin/ask.ts`) — is deferred to **A6b**; the `core/bin/*` commands are the legacy in-memory demo path (the real durable entrypoint is `openhawkins-run` in `packages/state`), so wiring vault-backed adapter keys there is lower-value and is tracked separately.

**Tech Stack:** TypeScript (strict ESM, `.js` specifiers), `node:crypto` scrypt/AES-256-GCM, `node:fs/promises`, Vitest.

---

## File Structure

- `packages/core/src/security/vault.ts` — `FileVault` internals: file format (`scrypt` params), `load`/`save`, a `serialize` tail, a `deriveKey` helper. `InMemoryVault` and the `Vault` interface are untouched.
- `packages/core/test/security/vault.test.ts` — new tests for concurrent writes, no leftover temp files, tunable cost + recorded params, and legacy (param-less) file back-compat.

---

### Task 1: Harden `FileVault` — atomic write, serialized mutations, tunable/raised scrypt

**Files:**

- Modify: `packages/core/src/security/vault.ts`
- Test: `packages/core/test/security/vault.test.ts`

- [ ] **Step 1: Write the failing tests (RED)**

Append these tests to `packages/core/test/security/vault.test.ts`. Update the imports at the
top of the file to add `readdirSync`/`writeFileSync` from `node:fs` and `dirname` from
`node:path`:

```ts
import { mkdtempSync, readFileSync, statSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, dirname } from "node:path";
```

Add a new describe block (the `vaultPath()` helper is already defined in the file's
`FileVault` describe — define a local one here too so this block is self-contained):

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run vault.test.ts`
Expected: FAIL — `scryptCost` is not a constructor option, no `scrypt` field is written, and
(depending on timing) the concurrent-set test drops writes.

- [ ] **Step 3: Rewrite `vault.ts` `FileVault` (and imports/format) to make them pass**

Replace the imports, the `VaultFile` interface, and the entire `FileVault` class in
`packages/core/src/security/vault.ts` with the following. `InMemoryVault` and the `Vault`
interface above it are unchanged.

```ts
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from "node:crypto";
import { readFile, mkdir, open, rename } from "node:fs/promises";
import { dirname } from "node:path";
```

```ts
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
   *  modify-write is never interleaved with another. Mirrors the audit log's tail. */
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
    // intact new one — never a truncated vault (review F-H5).
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
```

- [ ] **Step 4: Run the vault tests to verify they pass**

Run: `npx vitest run vault.test.ts`
Expected: PASS (all original tests + the four new ones).

- [ ] **Step 5: Verify the package + test project typecheck and the file is Prettier-clean**

Run: `npm run build && npx prettier --check packages/core/src/security/vault.ts packages/core/test/security/vault.test.ts`
Expected: clean.

- [ ] **Step 6: Confirm coverage of the changed file is 100%**

Run: `npx vitest run --coverage vault.test.ts` (or the full `npm run coverage`) and confirm
`vault.ts` shows 100% statements/branches/functions/lines. If the `tail`'s `.catch` callback
is uncovered, note that the existing "wrong passphrase rejects" test must route through
`serialize` (it does — `get` is now serialized) so the rejection path is exercised.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/security/vault.ts packages/core/test/security/vault.test.ts
git commit -m "feat(vault): atomic writes, serialized mutations, raised scrypt cost (F-H5)"
```

---

### Task 2: Roadmap update + full gate

**Files:**

- Modify: `docs/reviews/2026-06-09-production-readiness-review.md` (A6 line + A6b follow-up)

- [ ] **Step 1: Mark A6 done and add the A6b follow-up in the roadmap**

In `docs/reviews/2026-06-09-production-readiness-review.md`, replace the A6 roadmap line
(item 6, "**A6 — Vault durability + security (F-H5).**") with:

```md
6. **A6 — Vault durability + security (F-H5) ✅ DONE (PR pending).** `FileVault` now writes atomically (temp file + `fsync` + `rename`, so a crash never corrupts the live vault), serializes every `get`/`set`/`delete` through a single promise-chain tail (concurrent `set`s can no longer drop each other's writes), and derives keys at a raised, tunable scrypt cost (default N=65536) whose parameters are recorded per file so legacy param-less files still decrypt. **A6b (future)** — wire adapter keys through the Vault in the CLI (`bin/ask.ts` still reads `process.env`); deferred because `core/bin/*` is the legacy in-memory demo path, not the durable `openhawkins-run` entrypoint.
```

- [ ] **Step 2: Full repo gate**

Run:

```bash
npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional
```

Expected: all green, coverage 100%.

- [ ] **Step 3: Docker gate**

Run: `docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test`
Expected: `✅ ALL GATES PASSED`

- [ ] **Step 4: Commit**

```bash
git add docs/reviews/2026-06-09-production-readiness-review.md
git commit -m "docs(review): A6 vault hardened (F-H5); A6b CLI key-wiring deferred"
```
