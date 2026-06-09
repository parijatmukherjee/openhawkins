# Track A2 — Key the Audit Chain (HMAC) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the audit chain tamper-PROOF, not just a corruption checksum (finding **F-C2**). Today `hashEntry` is unkeyed `SHA-256(public data)` — anyone who can write the log can recompute a valid chain. This switches the chain to **keyed HMAC-SHA256**: `verify()` only succeeds for a holder of the key, so a log-writer without the key cannot forge a verifying chain. The decision was "the most secured way": there is **no unkeyed fallback** — the chain is always HMAC. A persistent key for the durable audit is minted and stored in the Vault; the in-memory audit auto-mints an ephemeral key (so the pervasive `new InMemoryAuditLog()` sites keep working).

**Architecture:** `hashEntry(key, prevHash, e)` becomes HMAC over the same canonical form. `InMemoryAuditLog(key?)` auto-mints an ephemeral key when none is given (always keyed; never the old SHA-256 path). `SqliteAuditLog(db, key)` REQUIRES a key (a durable log needs a persistent key to verify after reopen). `resolveAuditKey(vault)` mints-or-loads a persistent random key from the Vault. Docs are corrected: keyed HMAC = "tamper-proof under a Cabin-held key"; the over-claimed "tamper-evident" checksum framing is removed (F-C2). **External anchoring** (publishing the chain head to an append-only external store, for evidence even against full host compromise) is a larger, separate feature tracked as **A2b**.

**Tech Stack:** TypeScript strict (`exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM `.js` specifiers, Vitest, Node 24 + Bun 1.3. Prettier printWidth 100, double quotes. `node:crypto` `createHmac`/`randomBytes` (Node + Bun safe).

**Review basis:** [`docs/reviews/2026-06-09-production-readiness-review.md`](../reviews/2026-06-09-production-readiness-review.md) — **A2 / F-C2** (and the F-H3 serialization already landed in A1).

**Depends on (merged, A1):** `packages/core/src/security/audit.ts` (`hashEntry`, `InMemoryAuditLog`, `GENESIS`, `AuditLog`/`AuditInput`/`AuditEntry`), `packages/state/src/audit-store.ts` (`SqliteAuditLog`), `packages/core/src/security/vault.ts` (`Vault` = `{get(k):Promise<string|null>; set(k,v):Promise<void>; delete(k):Promise<void>}`, `InMemoryVault`).

**Conventions:** Coverage ≥99%; changed src files 100%. No test calls `hashEntry` directly (verified), so the signature change ripples only to the two AuditLog implementations + their tests. `new InMemoryAuditLog()` (no key) must keep compiling — the key is optional there.

---

### Task 1: Keyed `hashEntry` (HMAC) + auto-minting `InMemoryAuditLog`

**Files:**

- Modify: `packages/core/src/security/audit.ts`
- Test: `packages/core/test/security/audit.test.ts`

- [ ] **Step 1: Write the failing/changed tests.** READ `packages/core/test/security/audit.test.ts` first. Update it so it reflects keyed behavior, and ADD these cases (adapt to the file's existing style/imports):

```ts
import { InMemoryAuditLog, hashEntry, mintAuditKey, GENESIS } from "../../src/security/audit.js";

describe("keyed audit chain (HMAC)", () => {
  it("a chain built under key K verifies under K", async () => {
    const key = mintAuditKey();
    const a = new InMemoryAuditLog(key);
    await a.append({ kind: "X", data: { v: 1 }, at: 1 });
    await a.append({ kind: "Y", data: { v: 2 }, at: 2 });
    expect(await a.verify()).toBe(true);
  });

  it("hashEntry is keyed: the same content under different keys differs (forgery resistance)", () => {
    const e = { seq: 0, at: 1, kind: "X", data: { v: 1 } };
    const h1 = hashEntry(mintAuditKey(), GENESIS, e);
    const h2 = hashEntry(mintAuditKey(), GENESIS, e);
    expect(h1).not.toBe(h2); // different keys -> different MAC, so the chain can't be recomputed without K
  });

  it("auto-mints an ephemeral key when none is supplied (always keyed, never unkeyed)", async () => {
    const a = new InMemoryAuditLog(); // no key -> ephemeral
    await a.append({ kind: "Z", data: {}, at: 1 });
    expect(await a.verify()).toBe(true);
  });

  it("mintAuditKey returns 32 random bytes", () => {
    const k = mintAuditKey();
    expect(k).toBeInstanceOf(Buffer);
    expect(k.length).toBe(32);
    expect(mintAuditKey().equals(k)).toBe(false);
  });
});
```

Keep/repair the existing audit tests: any existing call like `hashEntry(prevHash, e)` becomes `hashEntry(key, prevHash, e)`; any `new InMemoryAuditLog()` that asserts cross-instance reproducibility must now pass an explicit shared key. Most existing in-instance tests need no change (auto-mint).

- [ ] **Step 2: Run → fail.** `npx vitest run packages/core/test/security/audit.test.ts`.

- [ ] **Step 3: Edit `packages/core/src/security/audit.ts`:**

Change the import and `hashEntry`, add `mintAuditKey`, and key the `InMemoryAuditLog`:

```ts
import { createHmac, randomBytes } from "node:crypto";
```

```ts
/** A fresh random 32-byte audit HMAC key. Persist it (the Vault) to verify a durable
 *  chain after restart; an in-memory log mints an ephemeral one per instance. */
export function mintAuditKey(): Buffer {
  return randomBytes(32);
}

/**
 * Keyed chain MAC: HMAC-SHA256(key, prevHash + canonical(entry)). Keying makes the chain
 * tamper-PROOF — a writer without `key` cannot produce a chain that `verify()` accepts
 * (unlike an unkeyed hash, which anyone can recompute). The canonical form is unchanged.
 */
export function hashEntry(
  key: Buffer,
  prevHash: string,
  e: { seq: number; at: number; kind: string; data: unknown },
): string {
  const canonical = JSON.stringify([e.seq, e.at, e.kind, e.data]);
  return createHmac("sha256", key)
    .update(prevHash + canonical)
    .digest("hex");
}
```

In `InMemoryAuditLog`, hold a key and pass it through:

```ts
export class InMemoryAuditLog implements AuditLog {
  private readonly log: AuditEntry[] = [];
  private readonly key: Buffer;

  /** `key` defaults to a fresh ephemeral key — the in-memory log is never durable, so a
   *  per-instance key is fine; a durable log must supply a persistent key. */
  constructor(key: Buffer = mintAuditKey()) {
    this.key = key;
  }
  // ...append(): hash: hashEntry(this.key, prevHash, base)
  // ...verify(): hashEntry(this.key, prev, {...})
}
```

Update the doc comment at the top of the class/file: replace any "tamper-evident" wording that implied the unkeyed hash was sufficient with the keyed framing (HMAC; tamper-proof under the held key).

- [ ] **Step 4: Run → pass + 100% coverage of `audit.ts`.**
      `npx vitest run packages/core/test/security/audit.test.ts --coverage.enabled --coverage.include='packages/core/src/security/audit.ts'` — 100%. (The `key = mintAuditKey()` default param is covered by the no-key test; the explicit-key path by the keyed tests.)

- [ ] **Step 5: Gates + build.** prettier/eslint on the two files; `npm run build` (this BREAKS `SqliteAuditLog` until Task 3 — that is expected; do NOT run the full build green here, just `tsc` of core, OR proceed to commit and let Task 3 fix state). Run `npx tsc -b packages/core` (core alone) — must be clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/security/audit.ts packages/core/test/security/audit.test.ts
git commit -m "feat(security): keyed HMAC audit chain + mintAuditKey (F-C2); InMemoryAuditLog auto-mints"
```

---

### Task 2: `resolveAuditKey(vault)` — persistent key from the Vault

**Files:**

- Modify: `packages/core/src/security/audit.ts` (add `resolveAuditKey`)
- Test: `packages/core/test/security/audit.test.ts` (add a describe block)

- [ ] **Step 1: Write the failing test** (append to the audit test):

```ts
import { resolveAuditKey } from "../../src/security/audit.js";
import { InMemoryVault } from "../../src/security/vault.js";

describe("resolveAuditKey", () => {
  it("mints + stores a key on first use and returns the SAME key thereafter", async () => {
    const vault = new InMemoryVault();
    const k1 = await resolveAuditKey(vault);
    expect(k1.length).toBe(32);
    const k2 = await resolveAuditKey(vault); // persisted -> identical
    expect(k2.equals(k1)).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail** (`resolveAuditKey` not exported).

- [ ] **Step 3: Add `resolveAuditKey` to `packages/core/src/security/audit.ts`:**

```ts
import type { Vault } from "./vault.js";

/** The Vault key under which the audit HMAC key is stored. */
const AUDIT_KEY_NAME = "audit:hmac-key";

/**
 * Load the persistent audit HMAC key from the Vault, minting + storing one on first use.
 * A durable audit log MUST use this (not an ephemeral key) so its chain still verifies
 * after a restart. The key lives in the Vault, never next to the log it protects.
 */
export async function resolveAuditKey(vault: Vault): Promise<Buffer> {
  const existing = await vault.get(AUDIT_KEY_NAME);
  if (existing !== null) {
    return Buffer.from(existing, "hex");
  }
  const key = mintAuditKey();
  await vault.set(AUDIT_KEY_NAME, key.toString("hex"));
  return key;
}
```

- [ ] **Step 4: Run → pass + 100% coverage** (`existing !== null` both arms covered: first call mints, second loads).

- [ ] **Step 5: Gates + `npx tsc -b packages/core`.** Clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/security/audit.ts packages/core/test/security/audit.test.ts
git commit -m "feat(security): resolveAuditKey — persistent audit HMAC key from the Vault (F-C2)"
```

---

### Task 3: `SqliteAuditLog` requires a key

**Files:**

- Modify: `packages/state/src/audit-store.ts` (constructor takes `key: Buffer`; pass to `hashEntry`)
- Test: `packages/state/test/audit-store.test.ts` + `packages/state/test/durable-run.integration.test.ts` (pass a key)

- [ ] **Step 1: Update the tests to pass a key.** In `packages/state/test/audit-store.test.ts`, import a key and thread it through every construction:

```ts
import { mintAuditKey } from "@openhawkins/core";
const KEY = mintAuditKey();
const fresh = () => new SqliteAuditLog(openDatabase({ path: ":memory:" }), KEY);
```

and update each `new SqliteAuditLog(db)` → `new SqliteAuditLog(db, KEY)` and `SqliteAuditLog.open(":memory:")` → `SqliteAuditLog.open(":memory:", KEY)`. **Important for the "reopened log continues the chain" test:** both instances must use the SAME `KEY` (they do — module constant). In `packages/state/test/durable-run.integration.test.ts`, likewise mint a `KEY` once and pass it to BOTH `new SqliteAuditLog(db, KEY)` and `new SqliteAuditLog(db2, KEY)` (the reopened audit must use the same key to verify).

- [ ] **Step 2: Run → fail** (`SqliteAuditLog` ctor takes 1 arg; `hashEntry` arity).

- [ ] **Step 3: Edit `packages/state/src/audit-store.ts`:**

- Import `mintAuditKey` is not needed here; import nothing new beyond the existing `hashEntry`/`GENESIS`/`redact`.
- Add a `private readonly key: Buffer;` field; require it in the constructor:

```ts
  constructor(db: SqlDriver, key: Buffer) {
    this.db = db;
    this.key = key;
    // ...existing migrate + prepares
  }

  static open(path: string, key: Buffer): SqliteAuditLog {
    return new SqliteAuditLog(openDatabase({ path }), key);
  }
```

- In `doAppend`: `const hash = hashEntry(this.key, prevHash, base);`
- In `verify`: `if (e.hash !== hashEntry(this.key, prev, { seq: e.seq, at: e.at, kind: e.kind, data: e.data }))`.
- Update the class doc: the chain is HMAC under a caller-supplied persistent key (tamper-proof under that key).

- [ ] **Step 4: Run → pass + 100% coverage** of `audit-store.ts`:
      `npx vitest run packages/state/test/audit-store.test.ts packages/state/test/durable-run.integration.test.ts --coverage.enabled --coverage.include='packages/state/src/audit-store.ts'` — all PASS, 100%.

- [ ] **Step 5: Gates + `npm run build`** (now the whole tree compiles again). Clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/state/src/audit-store.ts packages/state/test/audit-store.test.ts packages/state/test/durable-run.integration.test.ts
git commit -m "feat(state): SqliteAuditLog requires a persistent HMAC key (F-C2)"
```

---

### Task 4: Honest docs + roadmap + the full gate

**Files:**

- Modify: `docs/security-model.md` (correct any "tamper-evident" over-claim for the audit)
- Modify: `docs/reviews/2026-06-09-production-readiness-review.md` (mark A2; add A2b)

- [ ] **Step 1: Correct the security docs.** In `docs/security-model.md`, find the audit "tamper-evident" claim(s) and reword to: the audit chain is a **keyed HMAC** chain — tamper-proof against a writer who does not hold the Cabin-held key; external anchoring for evidence against full host compromise is future work (A2b). (grep `tamper` in docs to find the lines.)

- [ ] **Step 2: Update the roadmap.** In `docs/reviews/2026-06-09-production-readiness-review.md` §3, mark **A2** done — change its line to begin `2. **A2 — Keyed HMAC audit chain (F-C2) ✅ DONE (PR pending).**` keeping the rest, and append a new item: `**A2b — External audit anchoring (future).** Publish the chain head hash to an append-only external store / periodic signatures, for tamper-evidence even against a full host compromise (beyond keyed HMAC).`

- [ ] **Step 3: Run the FULL repo gate.**
      `npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional` — all green; aggregate ≥99%; `audit.ts` + `audit-store.ts` 100%. If `format:check` complains, `npm run format` first. Paste the coverage tail.

- [ ] **Step 4: Docker gate.** `docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test` → `✅ ALL GATES PASSED`.

- [ ] **Step 5: Commit.**

```bash
git add docs/security-model.md docs/reviews/2026-06-09-production-readiness-review.md
git commit -m "docs: audit is keyed HMAC (tamper-proof under the Cabin key), not a checksum (F-C2); track A2b"
```

---

## Self-Review (coverage of the A2 scope)

- **F-C2 — keyed audit:** `hashEntry` → HMAC (Task 1); `mintAuditKey` + auto-minting `InMemoryAuditLog` (Task 1); `resolveAuditKey` persistent Vault key (Task 2); `SqliteAuditLog` requires a key (Task 3); honest docs (Task 4). ✓
- **"Most secured way":** no unkeyed/forgeable mode survives — every chain is HMAC; durable chains use a persistent Vault key. ✓
- **Backward compat:** `new InMemoryAuditLog()` keeps compiling (auto-mint), so the many consumer tests (runner/agent-run/system-e2e/agent) are untouched; only audit-specific + Sqlite tests change. ✓
- **No package cycle:** `state` imports `mintAuditKey`/`hashEntry` from `core` (existing direction). ✓
- **Type consistency:** `hashEntry(key, prevHash, e)`, `mintAuditKey(): Buffer`, `resolveAuditKey(vault): Promise<Buffer>`, `InMemoryAuditLog(key?)`, `SqliteAuditLog(db, key)` — used identically across tasks. ✓

## Next (Track A continues)

A3 (event-plane redaction, F-C3) — broaden `redact` + apply it at the event-store boundary. Then A4 (adapter hardening), A5 (dual-replans), A6 (vault), A7 (observability), A8 (input caps + citation). **A2b** (external anchoring) and **A1b** (runtime durable cutover) are tracked follow-ups.
