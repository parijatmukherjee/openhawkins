/**
 * Secret redaction (spec §8.1/§8.5). Secrets must never land in events, the audit
 * log, or assembled prompts. This redacts by **key name** (anything that looks like
 * a credential field) and by **value shape** (provider key / token / PII patterns),
 * recursively, returning a deep copy — the input is never mutated.
 *
 * Value shapes covered include OpenAI `sk-` keys, bearer tokens, AWS/Google/GitHub/
 * Stripe/Slack provider key shapes, JWTs, PEM private-key blocks, and email PII.
 *
 * Key-name matching is deliberately NARROW: it must catch credential fields but never
 * match structural fields the runtime needs for replay (`session*`, `*id`, `type`,
 * `phase`, `at`, `turn*`, `agent*`). Those must survive redaction unchanged.
 */
export const REDACTED = "[REDACTED]";

// Field names whose values are secrets regardless of content. Deliberately NARROW —
// must NOT match structural fields the runtime needs (session/id/type/phase/at).
const SECRET_KEY =
  /(secret|token|api[-_]?key|password|passphrase|passwd|pwd|authorization|bearer|credential|private[-_]?key|access[-_]?token|client[-_]?secret|cookie)/i;

// Value shapes that are secrets/PII regardless of field name. Each is applied globally.
const SECRET_VALUES: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI-style
  /Bearer\s+\S+/g,
  /(AKIA|ASIA)[A-Z0-9]{16}/g, // AWS access key id
  /AIza[A-Za-z0-9_-]{35}/g, // Google API key
  /gh[posru]_[A-Za-z0-9]{36}/g, // GitHub token
  /github_pat_[A-Za-z0-9_]{22,}/g, // GitHub fine-grained PAT
  /(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g, // Stripe
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWT
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g, // PEM
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, // email PII
];

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_VALUES.reduce((s, re) => s.replace(re, REDACTED), value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? REDACTED : redact(v);
    }
    return out;
  }
  return value;
}
