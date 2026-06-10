# Production-Readiness Review & Remediation Roadmap

**Date:** 2026-06-09
**Trigger:** Goal raised to "production-ready, used by millions of users across the world."
**Method:** Three independent read-only architecture reviews — architecture/scale, security, code/design — synthesized and de-duplicated here.
**Status:** Findings accepted; remediation split into **Track A (correctness hardening, now)** and **Track B (scale-topology re-architecture, roadmap)**. Both approved.

---

## 1. Verdict

OpenHawkins is a clean, strict-typed **S1 foundation** — correct pure cores (the phase machine, citations, the capability check), good per-module unit tests, and a real "model proposes, runtime enforces" tool path. It is **not production-ready**, and the gap to "millions of users" is **structural, not a tuning problem**.

Two framing truths:

1. **The ≥99% coverage gate is giving false confidence.** It certifies the in-memory, scripted-model happy path. The parts that fail in production — the durable store, real model adapters under network/parse errors, timeouts, concurrency, partial failures — are either **unwired** (`SqliteEventStore`, a durable audit, the Vault, VECNA memory, markdownify) or **untested for failure modes**.
2. **The thesis and the goal point in opposite directions.** ADR 0001 commits to a **single self-contained binary with embedded SQLite**. "Millions of global users" is a distributed-systems problem (stateless tier + externalized state + multi-tenancy). These are effectively two products sharing a core; the single binary should become a _self-host deployment profile_, not the only topology.

---

## 2. Findings (synthesized, de-duplicated)

Severity is rated against the production-at-scale bar. Each item lists representative evidence; see §3 for the remediation mapping.

### Critical

- **F-C1 — Nothing is actually persisted.** The runtime runs entirely on `InMemoryEventStore`/`InMemoryAuditLog`; `SqliteEventStore` is dead code (zero non-test references) and **there is no durable audit implementation at all**. All session state and the entire audit trail are lost on every restart — so the "event-sourced / deterministic replay / tamper-evident audit" guarantees are false in the running system, even for a single user.
  _Evidence:_ `packages/core/src/eval/agent.ts:46-47`, `packages/core/src/playbook/build-agent-run.ts:42-43`, `packages/core/src/security/audit.ts:8`. `core` does not depend on `@openhawkins/state`.

- **F-C2 — The audit is a corruption checksum, not tamper-proof.** `hashEntry` is unkeyed `SHA256(prevHash + canonical)` over public data; anyone who can write the log can recompute a valid chain. Docs over-claim "tamper-evident."
  _Evidence:_ `packages/core/src/security/audit.ts:31-39`.

- **F-C3 — Secrets/PII persist in cleartext.** `redact()` is the only secrets barrier and it is wired into the **audit path only — not the VINES event store**, which commits raw user `input` and model `final`. It also only matches `sk-`/`Bearer` shapes (misses AWS/GCP/GitHub/Stripe/JWT/PEM, and all PII).
  _Evidence:_ `packages/core/src/security/redact.ts:10-13`; raw commits at `session/session.ts:50-76`, `playbook/runner.ts:188-191`.

- **F-C4 — Real adapters' failure modes are untested; unguarded `JSON.parse`.** A provider `200 OK` with a non-JSON body (gateway/captcha/rate-limit HTML) throws an uncaught `SyntaxError` that kills the turn. Every loop test uses the scripted adapter.
  _Evidence:_ `packages/core/src/models/openai-compat.ts:75-79`, `models/ollama.ts:73-77`.

- **F-C5 — Single-process + embedded SQLite + zero multi-tenancy.** No server/gateway tier, no horizontal scaling; `sessionId = ${agentId}-session` is global with no tenant dimension; SQLite is opened with no WAL / `busy_timeout` (throws `SQLITE_BUSY` under any concurrency). Cannot serve millions without a topology redesign.
  _Evidence:_ ADR 0001; `packages/state/src/driver/select.ts`; `build-agent-run.ts:46`; grep: zero `tenant`/`server`/`listen` references.

### High

- **F-H1 — No timeouts / retries / cancellation / backpressure** on model calls or the gate spawn → a hung dependency wedges a turn, and the single-writer chain head-of-line-blocks the whole session. _Evidence:_ `models/http.ts:23`, `playbook/gate-command.ts:21`; grep: zero `AbortController`/`timeout`/`retry`.
- **F-H2 — Dual source of truth for `replans`.** `machine.step()` computes the next count and the runner discards it; the event-fold (`reducePlaybook`) independently increments — a latent drift that breaks "fold the log = state." _Evidence:_ `playbook/machine.ts:34-40` vs `playbook/events.ts:54-55` + `runner.ts:98-101`.
- **F-H3 — Audit chain is concurrency-unsafe.** `prevHash`/`seq` derive from `log.length`; a shared log + overlapping `append` (e.g. `Promise.all`) silently forks the chain. _Evidence:_ `security/audit.ts:45-46` (shared in `build-agent-run.ts`).
- **F-H4 — Capability scope is advisory.** A scoped grant satisfies a scopeless requirement, and no shipped tool sets a scope → zero confinement. Do not ship `shell`/`fs:write`/`network` before inverting this. _Evidence:_ `security/capability.ts:32-38` (its own `KNOWN-LIMITATION`).
- **F-H5 — Vault is data-loss-grade and unwired.** Non-atomic whole-file write, no locking (concurrent `set` drops secrets; a crash mid-write makes _all_ secrets unrecoverable), low default scrypt cost; CLIs read keys from `process.env` instead of the Vault. _Evidence:_ `security/vault.ts:62-72,97-112`; `bin/ask.ts:51-67`.
- **F-H6 — Coupling / unwired subsystems.** The "real" `Agent` lives in `eval/` wired to `probe-agent` fixtures; **markdownify and VECNA memory are entirely unwired** from the runtime (shipped + tested but inert — inflating coverage). _Evidence:_ `eval/agent.ts`, `build-agent-run.ts:47`; grep: no `markdownify`/`VECNA` refs in `core/src`.

### Medium

- **F-M1 — No structured logging / observability** anywhere; "never-throws" swallow points (registry, gates, converters, adapters) become undiagnosable silent degradations. _Evidence:_ grep: no `logger`/`pino`/`console` outside `bin/`.
- **F-M2 — Input-size DoS + a real bug.** `csv.ts` `Math.max(...rows.map(...))` throws `RangeError` on large CSVs; no converter caps input size or nesting depth (turndown/fast-xml-parser parse unbounded). _Evidence:_ `markdownify/src/converters/csv.ts:62`, `converters/xml.ts:43`.
- **F-M3 — Citation numeric verification is spoofable.** `containsNumber` matches the value _anywhere_ in the tool-result payload, not the cited field — the "cited" grounding headline is weaker than claimed. _Evidence:_ `grounding/citations.ts:74-86`.
- **F-M4 — No `https`/SSRF guard or request timeout** on provider HTTP; a `http://` base sends the bearer key in cleartext. _Evidence:_ `models/http.ts:23`, `ollama.ts:42`, `openai-compat.ts:41`.

### Calibration

Several Criticals (F-C1, F-C3, F-C5) and Highs (F-H4, F-H5) are **explicit, documented v1 choices** for a single-operator self-host runtime (design §2 non-goals, ADR 0001). They become flaws only against the imposed "millions of users" bar. The genuine **bugs at any scale** are: F-C1 (durability unwired → restart data loss despite a durability promise), F-C4 (unguarded `JSON.parse`), F-H2 (dual `replans`), F-M2 (CSV `RangeError`), and SQLite-without-WAL throwing under any concurrency.

---

## 3. Remediation roadmap

### Track A — correctness hardening (now; each its own design→plan→PR behind the existing gate)

Ordered by leverage (foundational first):

1. **A1 — Durable `SqliteAuditLog` + injectable durability seam, integration-proven (F-C1 PARTIAL ✅; PR pending).** Built the durable hash-chained `SqliteAuditLog` in `packages/state` (reusing core's chain algorithm), made `buildAgentRun` accept injected `store`/`audit`, and added a state-package integration test proving replay + audit parity across a real file reopen. Enabled WAL + `busy_timeout` (F-C5 partial); serialized appends (F-H3, in-instance). **Not yet cut over:** the running entrypoint (`bin/run.ts`) still defaults to the in-memory stores, so the live runtime continues to persist nothing until a composition root wires the SQLite stores — and `bin/run.ts` lives in `core`, which by design must not import `state` (cycle). **Follow-up A1b — Runtime durable cutover ✅ DONE (PR pending).** A `packages/state` composition root (`buildDurableAgentRun` + `verifyDurable` + the `openhawkins-run` CLI with `--db`/`--vault`/`--verify`) wires the SQLite event store + the Vault-keyed `SqliteAuditLog` into a runnable entrypoint, proven across processes by a black-box e2e (run writes a durable keyed chain; a SEPARATE process reopens the db+Vault and the chain verifies). So **F-C1 (durability) and F-C2 (keyed audit) are now closed AT RUNTIME**, not just in the library. (The legacy in-memory `core/bin/run.ts` demo remains for offline use.) _Foundational — everything else builds on the durable implementation._
2. **A2 — Keyed HMAC audit chain (F-C2) ✅ DONE (PR pending).** HMAC-SHA256 under a Vault-held key; serialized appends; honest docs. Closed at the library level here and **at runtime via A1b**.
   - **A2b — External audit anchoring (future).** Publish the chain head hash to an append-only external store / periodic signatures, for tamper-evidence even against a full host compromise (beyond keyed HMAC).
   - **A2c — Audit verify diagnostics + key rotation (future).** Distinguish "wrong key" from "tampered" in verify() (e.g. a key-check token or a richer result with the first bad seq), and a key-rotation/versioning path (per-entry keyId) so rotating the audit key doesn't invalidate history.
3. **A3 — Redact the data plane + broaden patterns (F-C3) ✅ DONE (PR pending).** Apply redaction at the event-store boundary; expand to real provider key shapes + JWT/PEM/high-entropy + a PII pass. Add a "planted secret never appears in events/audit" test. Redaction is pattern-based (recognizable provider/PII shapes + email); generic high-entropy / broader-PII detection is future work.
4. **A4 — Harden the model/IO boundary (F-C4, F-H1, F-M4) ✅ DONE (PR pending).** `parseJsonOrThrow` turns a non-JSON provider body into a typed, diagnosable error instead of a raw `SyntaxError` (F-C4); `requestWithTimeout` aborts a hung request via `AbortController` after a per-adapter `timeoutMs`, and `withRetry` retries with exponential backoff (F-H1); `assertSafeBaseUrl` requires `https` for any non-loopback base so the bearer key never crosses the wire in cleartext (F-M4). Both the Ollama and OpenAI-compatible adapters are wired through all three, with `timeoutMs`/`retries`/`retryBaseMs` config (defaults 30000/2/200). **Honest scope:** `withRetry` wraps `requestWithTimeout`, so it retries connection/transport failures and timeouts but NOT an HTTP 5xx _response_ (a 5xx body is returned to the adapter, not thrown) — retry-on-5xx is a deliberate future tightening. The `runCommand` / gate-spawn execution timeout is also not yet bounded — deferred to **A4b**.
   - **A4b — Bound command execution (future).** Add an execution timeout (and kill-on-deadline) to `runCommand` / the gate spawn so a hung tool or gate process can't stall a turn indefinitely; consider retry-on-HTTP-5xx for idempotent provider calls.
5. **A5 — Fix the dual `replans` (F-H2) ✅ DONE (PR pending).** `reducePlaybook` (the fold over `PhaseGateFailed`) is now the sole place `replans` increments; `machine.step()` no longer carries a parallel count — its `Transition` returns only the target phase + outcome, and the escalate decision reads the canonical `state.replans` (`>= maxReplans`). A runner invariant test asserts `foldPlaybook(log).replans === run.state.replans`, so the "fold the log = state" property is regression-guarded.
6. **A6 — Vault durability + security (F-H5) ✅ DONE (PR pending).** `FileVault` now writes atomically (temp file + `fsync` + `rename`, so a crash never corrupts the live vault), serializes every `get`/`set`/`delete` through a single promise-chain tail (concurrent `set`s can no longer drop each other's writes), and derives keys at a raised, tunable scrypt cost (default N=65536) whose parameters are recorded per file so legacy param-less files still decrypt. The file fsync (not a dir fsync) is portable to the Windows CI matrix and still guarantees no corruption of previously-committed secrets.
   - **A6b — CLI key-wiring through the Vault (future).** `bin/ask.ts` still reads adapter keys from `process.env`; wire them through the Vault. Deferred because `core/bin/*` is the legacy in-memory demo path, not the durable `openhawkins-run` entrypoint (`packages/state`). Also: have `FileVault.save` unlink its temp file on a mid-write failure (today a rare fsync/write error can orphan a `*.tmp-*` sibling — harmless to the live vault, but worth sweeping).
7. **A7 — Observability (F-M1).** Inject a structured logger; emit at every swallow point (capability denials, gate/predicate failures, converter degradations, adapter parse errors).
8. **A8 — Input hardening (F-M2) + citation fix (F-M3).** `Math.max` → reduce; max-input-size + max-depth caps in the converter registry; verify cited values against the referenced field.

### Track B — scale-topology re-architecture (roadmap; design spec first, no code until approved)

A re-architecture for the millions bar (F-C5, F-H4, multi-tenancy), to be brainstormed into its own spec → decomposed roadmap:

- **Stateless orchestration tier** (N replicas behind a load balancer) rehydrating session/playbook state from the durable log (the `foldEvents` machinery already exists).
- **Externalized, horizontally-scalable state** behind the existing `SqlDriver` port (managed Postgres/partitioned event store), replacing embedded SQLite for the hosted profile; keep the single binary as a self-host profile.
- **Queue/worker tier** for the long-running, model-bound agent turns, with admission control + the promised concurrency scheduler.
- **Multi-tenancy** threaded through every event, audit entry, grant, tool context, and memory fragment (composite `tenantId`+`sessionId`, row-level isolation, per-tenant rate limits), plus encryption-at-rest and a crypto-shredding erasure model compatible with the append-only audit (GDPR).
- **Real capability confinement** (the deferred S6 process/OS sandbox) before any untrusted multi-tenant tool execution; invert scope matching to deny-by-default.

### Sequencing note

This review **re-prioritizes S3** (the Pulse/orchestrator composition). Building more on an unwired, non-durable, single-tenant foundation compounds the debt. Track A (and at least the Track B multi-tenancy + durable-store decisions) should precede further S3 work.

---

## 4. Status tracking

Each Track A item lands as its own PR referencing this document (`F-*` / `A*` ids). Track B begins with a design spec. This file is the canonical record of what was found and why; update the per-item status as PRs merge.
