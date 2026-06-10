# OpenHawkins — checkpoint

> At-a-glance status for anyone (AI agent or human) picking up this project. Read this
> first, then [`AGENT.md`](AGENT.md) for how to work here. Detailed, authoritative
> trackers live under `docs/` and are linked below.
>
> **Last updated:** 2026-06-10 · **Default branch:** `main` (protected; required
> `docker-gate`) · **Tests:** 455 passing / 1 skipped, **99.67% coverage** (gate floor 99%).
> **Zero-Flaw Campaign: 24/24 ✅**

---

## 1. What this is

A self-owned AI-agent runtime with the Hawkins multi-agent orchestration pattern.
TypeScript monorepo, embedded SQLite, single self-contained binary, runs on Node and
Bun. Thesis: **the model proposes, the runtime enforces** (grounding, tool-calling,
state, capabilities). Full vision: [`docs/specs/2026-06-05-openhawkins-design.md`](docs/specs/2026-06-05-openhawkins-design.md).

## 2. Packages that exist today

| Package                    | Status | Role                                                                                                                                                                                                           |
| -------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@openhawkins/core`        | 🟢     | Agent loop, model adapters, tool registry (**The Lab**), **Eleven** grounding, **Murray** audit, **The Cabin** vault, **The Gate** taint/approval, redaction, structured logging, the Playbook process engine. |
| `@openhawkins/state`       | 🟢     | **VINES**: durable SQLite (`SqlDriver` + migrations + event store + keyed audit store) and the durable composition root (`buildDurableAgentRun` + `openhawkins-run` CLI).                                      |
| `@openhawkins/memory`      | 🟢     | **VECNA**: decay-aware memory (fragments, recall, pure-JS embeddings + FTS5 fallback). **Not yet wired into the agent path.**                                                                                  |
| `@openhawkins/markdownify` | 🟢     | Document → Markdown converters (CSV/HTML/JSON/XML/text) behind a never-throws `ConverterRegistry`. **Not yet wired into the agent path.**                                                                      |

Planned-but-not-started packages (orchestrator/Nexus, tendrils, channels, dashboard,
tickets/Board, gateway, plugin-sdk, registry, cli) are described in [`README.md`](README.md).

## 3. What's built and proven (done)

**S1 Foundation — the headline hallucination test passes.** Event-sourced session core
(durable `DomainEvent` log, single-writer serialized turns, reducer state, deterministic
replay); capability-gated never-throws `ToolRegistry` (default-deny + confused-deputy
guard); Ollama + OpenAI-compatible adapters over an injectable HTTP seam + a
`ScriptedAdapter`; the agent loop (native tool-calling with a model-call budget);
**Eleven** grounding (`off`/`preferred`/`required`/`cited`); **Murray** hash-chained
audit; the Playbook process engine (phase manifest + machine + runner + `AgentRun`
integration); `ask`/`run` CLIs + eval harness. Specs: `docs/specs/2026-06-05-S1-*`,
`docs/specs/2026-06-09-agentrun-playbook-integration-design.md`.

**Production-readiness hardening (Track A, A1–A7 merged).** From the
[production-readiness review](docs/reviews/2026-06-09-production-readiness-review.md)
(§3 is the authoritative tracker). All landed behind the gate, each its own PR:

| Item     | Finding(s)       | What shipped                                                                                                                                                                                    | PR       |
| -------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A1 + A1b | F-C1, F-C2       | Durable `SqliteAuditLog` + injectable store/audit seam; runtime cutover (`buildDurableAgentRun` + `openhawkins-run`), proven cross-process. Durability + keyed audit now closed **at runtime**. | #18, #20 |
| A2       | F-C2             | Keyed HMAC-SHA256 audit chain under a Vault-held key; serialized appends.                                                                                                                       | #19      |
| A3       | F-C3             | Redaction on the event-store data plane + broadened provider/PII patterns; planted-secret e2e.                                                                                                  | #21      |
| A4       | F-C4, F-H1, F-M4 | Guarded JSON parse, request timeout + bounded retry/backoff, https-for-non-loopback baseURL.                                                                                                    | #22      |
| A5       | F-H2             | Single source of truth for `replans` (the event fold); `fold==state` invariant test.                                                                                                            | #23      |
| A6       | F-H5             | `FileVault`: atomic writes (temp+fsync+rename), serialized mutations, raised/tunable scrypt cost.                                                                                               | #24      |
| A7       | F-M1             | Structured `Logger`/`JsonLogger` (redacted, to stderr); emit at tool-registry + gate swallow points.                                                                                            | #25      |

## 4. In flight

- **A8 — Input hardening (F-M2) + citation fix (F-M3).** Plan written
  (`docs/plans/2026-06-10-A8-input-hardening.md`, on branch `track-a8-input-hardening`).
  - **F-M2** (not yet coded): CSV column width via `reduce` (kill the `Math.max(...spread)`
    `RangeError`), a `maxInputChars` ceiling in `ConverterRegistry`, and an XML nesting-depth
    cap. Markdownify-only, self-contained.
  - **F-M3** (next PR after F-M2): verify a cited numeric value against the _referenced field_
    (the claim gains a field reference), not anywhere in the tool-result payload. Touches the
    claim schema, the scripted model, and the model-facing grounding prompt fragments.

## 5. What's next

**Track A follow-ups (small, deferred with honest scope notes in the review §3):**

- **A2b** — external audit anchoring (publish chain head / periodic signatures).
- **A2c** — audit `verify()` diagnostics (wrong-key vs tampered) + key rotation (per-entry keyId).
- **A4b** — bound `runCommand`/gate-spawn execution time; consider retry-on-HTTP-5xx.
- **A6b** — wire adapter keys through the Vault in the CLI; sweep orphaned vault temp files.
- **A7b** — instrument the markdownify `ConverterRegistry` (once it's wired in) via a structural
  log-sink; thread the logger through `buildProbeAgent`/`bin/ask.ts`.
- **F-H6 wiring** — actually wire `markdownify` (token reduction) and `memory` (VECNA) into the
  agent path; today both packages exist but are unused by a run.

**Track B — scale-topology re-architecture (design-only roadmap; no code until approved).**
For the "millions of users" bar (F-C5, F-H4, multi-tenancy): a stateless orchestration tier
rehydrating from the durable log, externalized horizontally-scalable state behind the existing
`SqlDriver` port, a queue/worker tier with admission control, multi-tenancy threaded through
every event/audit/grant/tool-context/memory-fragment, and real OS-level capability confinement.
Details in the review §3 (Track B). To be brainstormed into its own spec → decomposed roadmap.

**Product roadmap (beyond hardening):**

- **S2** — durable state + VECNA memory wired into the live agent path
  (`docs/specs/2026-06-08-S2-state-memory-design.md`). The durable stores exist (A1/A1b);
  memory injection into turns is the remaining work.
- **S3** — the **Nexus orchestrator**: the 5-phase Pulse loop, the tendril roster + routing,
  synthesis, an operator endpoint, channels + dashboard, RBAC + the Board. Decomposed into
  S3.1–S3.5 during earlier scoping; **paused** to finish the production-readiness foundation.
- **Process enforcement becomes native** — the AGENT.md operating loop itself becomes
  runtime-enforced by the Playbook engine (see [ADR 0002](docs/adr/0002-process-enforcement-native-not-n8n.md)
  and `docs/specs/2026-06-09-playbook-process-engine-design.md`).

## 6. How to work here

Follow [`AGENT.md`](AGENT.md): Research → Plan → Tasks → Execute (TDD) → Validate (the gate)
→ Present (PR). `main` is protected — land via a PR whose required `docker-gate` passes
(build · lint · format:check · coverage ≥99% · unit · functional). Conventional commits, one
logical change per commit.

## 7. Authoritative trackers (don't duplicate — update these)

- **Remediation status:** `docs/reviews/2026-06-09-production-readiness-review.md` §3 — the
  per-item source of truth for Track A / Track B. Keep its ✅ marks honest.
- **Design specs:** `docs/specs/` · **Implementation plans:** `docs/plans/` · **ADRs:**
  `docs/adr/` · **Security model:** `docs/security-model.md`.
