# OpenHawkins

> Your own AI-agent platform — a self-owned runtime with the Hawkins multi-agent
> orchestration pattern at its heart. Cross-platform (Windows / macOS / Linux),
> Telegram + Discord native, with a beautiful real-time dashboard.

OpenHawkins is a ground-up rebuild of the [`openclaw-hawkins`](../openclaw-hawkins)
orchestration pattern that **no longer rides on top of an external runtime**.
Instead of shelling out to `openclaw agent …`, OpenHawkins owns the whole stack:
the agent loop, the model adapters, the tool/skill engine, durable state, shared
memory, the chat channels, and the dashboard.

The headline goal: **make the runtime enforce what OpenClaw left to the model's
discretion** — tool-calling, grounding, state transitions, memory injection,
permissions, and concurrency. The model proposes; the runtime enforces. This is
how we kill the hallucination problem at the root.

## Status

> 📍 For an at-a-glance snapshot of what's built, in flight, and next, see
> [`CHECKPOINT.md`](CHECKPOINT.md). Contributors (AI or human) should start with
> [`AGENT.md`](AGENT.md).

🟢 **S1 Foundation complete + production-readiness hardening (Track A) landing.** Four
packages are real (`core`, `state`, `memory`, `markdownify`), gated by a required Docker
CI check plus a **>99% coverage gate** (374 unit tests + black-box functional e2e, 100%
coverage). What's built:

- **Event-sourced session core** — durable `DomainEvent` log, single-writer
  serialized turns, reducer-based state, deterministic replay.
- **The Lab — capability-gated tool registry** — default-deny, never-throws
  `ToolRegistry`, confused-deputy guard, Zod validation both directions.
- **Model adapters** — Ollama (local + cloud, one code path) and an
  OpenAI-compatible adapter, over an injectable HTTP seam; a `ScriptedAdapter` for
  deterministic replay. **The Cabin** secret vault (encrypted `FileVault`).
- **The agent loop** — native tool-calling round-trip with a model-call budget.
- **Eleven — the grounding engine** — `off`/`preferred`/`required`/`cited` modes;
  `required` rejects any answer before a successful qualifying tool call, `cited`
  verifies the structured answer's citations and numeric claims against the tool
  result, and the honest "unknown" is accepted. The model proposes; Eleven enforces.
- **Murray audit** + **The Gate** (taint → approval) + secret **redaction** — the audit
  is a **keyed HMAC** hash chain (tamper-evident, not just a checksum) under a Vault-held
  key, durable in SQLite and proven to verify across a process restart.
- **Durable by default at runtime** — `@openhawkins/state` (VINES) wires the SQLite event
  store + keyed audit into a runnable entrypoint (`openhawkins-run`); a separate process
  reopens the db + Vault and the chain verifies. The agent loop, audit, redaction, and
  Playbook trace all share one event-sourced, replayable log.
- **Hardened for production correctness** (Track A): atomic crash-safe `FileVault` with a
  raised scrypt cost; model/IO boundary with guarded JSON parse, request timeouts + bounded
  retry, and https-for-non-loopback; structured redacted logging at every swallow point;
  and a single source of truth for the Playbook replan count.
- **`ask` CLI + eval harness** — the same weak model, run `cited` vs `off`, rejects
  the fabricated "250 GB" guess and answers the real free-bytes vs lets the
  hallucination survive — proving the engine is the difference.

Try it: `node packages/core/dist/bin/ask.js "How much disk is free?" --json`
(or `--model ollama` against a real local model). For a durable, audited run:
`node packages/state/dist/bin/openhawkins-run.js --db run.db --vault vault.json`. The design
lives in [`docs/specs/2026-06-05-openhawkins-design.md`](docs/specs/2026-06-05-openhawkins-design.md);
the security model is in [`docs/security-model.md`](docs/security-model.md); the
production-readiness review + remediation roadmap is in
[`docs/reviews/2026-06-09-production-readiness-review.md`](docs/reviews/2026-06-09-production-readiness-review.md).

Next up: finish Track A input hardening (F-M2/F-M3), wire VECNA memory + markdownify into
the agent path (S2), then the Nexus orchestrator (S3). Track B (scale-topology
re-architecture for the millions bar) is a design-only roadmap. See
[`CHECKPOINT.md`](CHECKPOINT.md).

## The pieces

`core`, `state`, `memory`, and `markdownify` are **built today** (see
[`CHECKPOINT.md`](CHECKPOINT.md)); the rest are **planned**:

| Package        | Role                                                                                                |
| -------------- | --------------------------------------------------------------------------------------------------- |
| `core`         | Runtime: agent loop, model adapters, native tool-calling, **Grounding engine**, capability sandbox  |
| `state`        | Durable orchestration state (VINES reborn) — runtime-owned, SQLite-default                          |
| `memory`       | Decay-aware shared memory (VECNA reborn) — auto-injected, SQLite-default                            |
| `markdownify`  | Document → Markdown converters (CSV/HTML/JSON/XML/text) for token reduction — never-throws registry |
| `orchestrator` | The Nexus — routing, dispatch, synthesis (logic in code, not prose)                                 |
| `tickets`      | **The Board** — operator ticket tracking (Cases); replaces Linear                                   |
| `tendrils`     | Specialist agents (system/code/research/data/comm/vision), in-process                               |
| `channels`     | Telegram + Discord + CLI + WebSocket gateways                                                       |
| `dashboard`    | Astro app — real-time, motion-rich (Emil Kowalski · impeccable · Taste)                             |
| `gateway`      | The daemon tying it together                                                                        |
| `plugin-sdk`   | Public extension contract (Tendrils, tools, channels, adapters, widgets, skills)                    |
| `registry`     | Plugin loader + capability sandbox + future marketplace client                                      |
| `cli`          | `openhawkins` cross-platform command                                                                |

A **community plugin marketplace** (the OpenHawkins analogue of npm/ClawHub) is a
planned future phase — authors submit plugins, the registry validates manifests,
security-scans capabilities, and signs packages. The plugin SDK and capability
sandbox are v1 so this is possible without a breaking redesign.

## Stack

TypeScript everywhere, running on **Node and Bun** (the CI matrix runs both) · Astro
dashboard (planned) · embedded SQLite by default (no MariaDB requirement) · single
self-contained binary per OS.

## License

TBD (the source pattern is MIT).
