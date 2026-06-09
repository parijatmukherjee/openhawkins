import { createHmac, randomBytes } from "node:crypto";
import { redact } from "./redact.js";
import type { Vault } from "./vault.js";

/**
 * Murray — append-only, keyed-hash-chained audit (spec §8.5). Every grounding decision,
 * tool call, and correction is recorded; `entry.hash = HMAC-SHA256(key, prevHash + canonical(entry))`
 * so any later edit to a past entry breaks the chain and `verify()` returns false. Keying the
 * chain makes it tamper-PROOF under the held key: a writer without the key cannot forge a chain
 * that `verify()` accepts. Secrets are redacted on the way in. In-memory + JSONL in S1; durable in S2.
 */
export interface AuditInput {
  kind: string;
  data: Record<string, unknown>;
  at: number;
}

export interface AuditEntry extends AuditInput {
  seq: number;
  prevHash: string;
  hash: string;
}

export interface AuditLog {
  append(input: AuditInput): Promise<AuditEntry>;
  entries(): Promise<AuditEntry[]>;
  verify(): Promise<boolean>;
}

/** The chain's pre-genesis hash — the `prevHash` of the first entry. */
export const GENESIS = "0".repeat(64);

/** A fresh random 32-byte audit HMAC key. Persist it (the Vault) to verify a durable
 *  chain after restart; an in-memory log mints an ephemeral one per instance. */
export function mintAuditKey(): Buffer {
  return randomBytes(32);
}

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

export class InMemoryAuditLog implements AuditLog {
  private readonly log: AuditEntry[] = [];
  private readonly key: Buffer;

  /** `key` defaults to a fresh ephemeral key — an in-memory log is never durable, so a
   *  per-instance key is fine; a durable log must supply a persistent key. */
  constructor(key: Buffer = mintAuditKey()) {
    this.key = key;
  }

  async append(input: AuditInput): Promise<AuditEntry> {
    const prevHash = this.log.length > 0 ? this.log[this.log.length - 1].hash : GENESIS;
    const seq = this.log.length;
    // Redact secrets BEFORE hashing so the chain commits to the redacted form.
    const data = redact(input.data) as Record<string, unknown>;
    const base = { seq, at: input.at, kind: input.kind, data };
    const entry: AuditEntry = { ...base, prevHash, hash: hashEntry(this.key, prevHash, base) };
    this.log.push(entry);
    return entry;
  }

  async entries(): Promise<AuditEntry[]> {
    return [...this.log];
  }

  async verify(): Promise<boolean> {
    let prev = GENESIS;
    for (const e of this.log) {
      if (e.prevHash !== prev) {
        return false;
      }
      const expected = hashEntry(this.key, prev, {
        seq: e.seq,
        at: e.at,
        kind: e.kind,
        data: e.data,
      });
      if (e.hash !== expected) {
        return false;
      }
      prev = e.hash;
    }
    return true;
  }
}
