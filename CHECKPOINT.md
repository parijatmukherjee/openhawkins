# OpenJarvis — checkpoint

> At-a-glance status for anyone (AI agent or human) picking up this project. Read this
> first, then [`AGENT.md`](AGENT.md) for how to work here. Detailed, authoritative
> trackers live under `docs/` and are linked below.
>
> **Last updated:** 2026-06-11 · **Default branch:** `main` (protected; required
> `docker-gate`) · **Tests:** 623 passing / 1 skipped, **99.53% coverage** (gate floor 99%).
> **Zero-Flaw Campaign: 24/24 ✅**
> **S3 Nexus Orchestrator: IMPLEMENTED ✅**
> **Desktop App (Electron): MERGED ✅**

---

## 1. What this is

A self-owned AI-agent runtime with the Jarvis multi-agent orchestration pattern.
TypeScript monorepo, embedded SQLite, single self-contained binary, runs on Node and
Bun. Thesis: **the model proposes, the runtime enforces** (grounding, tool-calling,
state, capabilities). Full vision: [`docs/specs/2026-06-05-openjarvis-design.md`](docs/specs/2026-06-05-openjarvis-design.md).

## 2. Packages that exist today

| Package                   | Status | Role                                                                                                                                                                                                                   |
| ------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@openjarvis/core`        | 🟢     | Agent loop, model adapters, tool registry (**the Lab**), **GroundingEngine** grounding, **Audit** audit, **the Vault** vault, **the Gate** taint/approval, redaction, structured logging, the Playbook process engine. |
| `@openjarvis/state`       | 🟢     | **JarvisStateStore**: durable SQLite (`SqlDriver` + migrations + event store + keyed audit store) and the durable composition root (`buildDurableAgentRun` + `openjarvis-run` CLI).                                    |
| `@openjarvis/memory`      | 🟢     | **JarvisMemoryStore**: decay-aware memory (fragments, recall, pure-JS embeddings + FTS5 fallback). **Wired into the agent path** via `buildAgentRun`/`buildDurableAgentRun`/`buildProbeAgent`.                         |
| `@openjarvis/markdownify` | 🟢     | Document → Markdown converters (CSV/HTML/JSON/XML/text) behind a never-throws `ConverterRegistry`. **Wired into the agent path** via `createDocumentTool` + `buildDurableAgentRun`/`buildProbeAgent`.                  |
| `@openjarvis/jarvis`      | 🟢     | Vision skill interfaces (engine, detection, events, presence, mock, visual-resolver) + E2E automation suite (`MockUser`, 15 scenarios).                                                                                |
| `@openjarvis/agents`      | 🟢     | Built-in agents package with `VisionAgent`/`MockVisionAgent` (agent delegator, pool interfaces).                                                                                                                       |

Planned-but-not-started packages (orchestrator/Nexus, agents, channels, dashboard,
tickets/Board, gateway, plugin-sdk, registry, cli) are described in [`README.md`](README.md).

## 3. What's built and proven (done)

**S1 Foundation — the headline hallucination test passes.** Event-sourced session core
(durable `DomainEvent` log, single-writer serialized turns, reducer state, deterministic
replay); capability-gated never-throws `ToolRegistry` (default-deny + confused-deputy
guard); Ollama + OpenAI-compatible adapters over an injectable HTTP seam + a
`ScriptedAdapter`; the agent loop (native tool-calling with a model-call budget);
**GroundingEngine** grounding (`off`/`preferred`/`required`/`cited`); **Audit** hash-chained
audit; the Playbook process engine (phase manifest + machine + runner + `AgentRun`
integration); `ask`/`run` CLIs + eval harness. Specs: `docs/specs/2026-06-05-S1-*`,
`docs/specs/2026-06-09-agentrun-playbook-integration-design.md`.

**Production-readiness hardening (Track A, A1–A8 + follow-ups merged).** From the
[production-readiness review](docs/reviews/2026-06-09-production-readiness-review.md)
(§3 is the authoritative tracker). All landed behind the gate, each its own PR:

| Item        | Finding(s)       | What shipped                                                                                                                                                                                   | PR       |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A1 + A1b    | F-C1, F-C2       | Durable `SqliteAuditLog` + injectable store/audit seam; runtime cutover (`buildDurableAgentRun` + `openjarvis-run`), proven cross-process. Durability + keyed audit now closed **at runtime**. | #18, #20 |
| A2          | F-C2             | Keyed HMAC-SHA256 audit chain under a Vault-held key; serialized appends.                                                                                                                      | #19      |
| A3          | F-C3             | Redaction on the event-store data plane + broadened provider/PII patterns; planted-secret e2e.                                                                                                 | #21      |
| A4          | F-C4, F-H1, F-M4 | Guarded JSON parse, request timeout + bounded retry/backoff, https-for-non-loopback baseURL.                                                                                                   | #22      |
| A5          | F-H2             | Single source of truth for `replans` (the event fold); `fold==state` invariant test.                                                                                                           | #23      |
| A6          | F-H5             | `FileVault`: atomic writes (temp+fsync+rename), serialized mutations, raised/tunable scrypt cost.                                                                                              | #24      |
| A7          | F-M1             | Structured `Logger`/`JsonLogger` (redacted, to stderr); emit at tool-registry + gate swallow points.                                                                                           | #25      |
| A8          | F-M2, F-M3       | CSV `reduce` fix, `maxInputChars` ceiling, XML depth cap; citation verifies exact field path, not whole payload.                                                                               | #28      |
| A2b + A7b   | —                | External audit anchoring (`anchorAuditChain`/`verifyAnchor`) + markdownify `ConverterRegistry` instrumented with logger sink.                                                                  | #29      |
| F-H6 wiring | F-H6             | `markdownify` + `JarvisMemoryStore memory` wired into `buildAgentRun`, `buildDurableAgentRun`, and `buildProbeAgent` — both now active in the live agent path.                                 | #29      |

**Track A is now COMPLETE.** All 24 Zero-Flaw items closed.

## 4. In flight

**(nothing)** — all planned work is done.

## 5. What's next

**S3 — the Nexus orchestrator.** The production-readiness foundation is complete.
Next canonical work is the **Nexus orchestrator** (the 5-phase Pulse loop, agent
roster + routing, synthesis, operator endpoint). This is a large, multi-phase
subsystem requiring a design spec first.

**Track B — personal assistant, local-first, multi-device sync (design-only roadmap; no code until approved).**
For the "one person's personal assistant" vision: device identity & approval, local-first
CRDT sync, device discovery over LAN, cross-device task scheduling. Spec written
(`docs/specs/2026-06-10-track-b-personal-assistant.md`).

**Process enforcement becomes native** — the AGENT.md operating loop itself becomes
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
