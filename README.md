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

🟢 **S1 Foundation complete — the headline hallucination test passes.** The
`@openhawkins/core` package is real and gated by a required Docker CI check plus a
**>99% coverage gate** (148 unit tests + black-box functional e2e). What's built:

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
- **Murray audit** (hash-chained, tamper-evident) + **The Gate** (taint →
  approval) + secret **redaction**.
- **`ask` CLI + eval harness** — the same weak model, run `cited` vs `off`, rejects
  the fabricated "250 GB" guess and answers the real free-bytes vs lets the
  hallucination survive — proving the engine is the difference.

Try it: `node packages/core/dist/bin/ask.js "How much disk is free?" --json`
(or `--model ollama` against a real local model). The design lives in
[`docs/specs/2026-06-05-openhawkins-design.md`](docs/specs/2026-06-05-openhawkins-design.md);
the security model is in [`docs/security-model.md`](docs/security-model.md).

Next up: durable SQLite state + VECNA memory (S2) and the Nexus orchestrator (S3).

## The pieces (planned)

| Package        | Role                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `core`         | Runtime: agent loop, model adapters, native tool-calling, **Grounding engine**, capability sandbox |
| `state`        | Durable orchestration state (VINES reborn) — runtime-owned, SQLite-default                         |
| `memory`       | Decay-aware shared memory (VECNA reborn) — auto-injected, SQLite-default                           |
| `orchestrator` | The Nexus — routing, dispatch, synthesis (logic in code, not prose)                                |
| `tickets`      | **The Board** — operator ticket tracking (Cases); replaces Linear                                  |
| `tendrils`     | Specialist agents (system/code/research/data/comm/vision), in-process                              |
| `channels`     | Telegram + Discord + CLI + WebSocket gateways                                                      |
| `dashboard`    | Astro app — real-time, motion-rich (Emil Kowalski · impeccable · Taste)                            |
| `gateway`      | The daemon tying it together                                                                       |
| `plugin-sdk`   | Public extension contract (Tendrils, tools, channels, adapters, widgets, skills)                   |
| `registry`     | Plugin loader + capability sandbox + future marketplace client                                     |
| `cli`          | `openhawkins` cross-platform command                                                               |

A **community plugin marketplace** (the OpenHawkins analogue of npm/ClawHub) is a
planned future phase — authors submit plugins, the registry validates manifests,
security-scans capabilities, and signs packages. The plugin SDK and capability
sandbox are v1 so this is possible without a breaking redesign.

## Stack

TypeScript / Node everywhere · Astro dashboard · embedded SQLite by default
(no MariaDB requirement) · single-binary distribution per OS.

## License

TBD (the source pattern is MIT).
