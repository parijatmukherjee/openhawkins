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

🟢 **S1 Foundation in progress.** The `@openhawkins/core` package is real, tested
(42 passing tests), and gated by a required Docker CI check. Merged so far:

- **Event-sourced session core** — durable `DomainEvent` log, serialized turns
  (turns never overlap), reducer-based state, and replay.
- **The Lab — capability-gated tool registry** — default-deny `grantSatisfies`, a
  `ToolRegistry.invoke()` that never throws (structured `ToolResult`), a
  confused-deputy guard, and Zod validation of tool args _and_ results. Proven
  end-to-end by the `disk_free` tool.
- **Native-tool-calling groundwork** — Zod → JSON Schema export for the model
  adapters landing in S1.3.

Next up: model adapters + secret vault (S1.3), the agent loop (S1.4), and the
Eleven grounding engine (S1.5+). The design lives in
[`docs/specs/2026-06-05-openhawkins-design.md`](docs/specs/2026-06-05-openhawkins-design.md);
the security model is in [`docs/security-model.md`](docs/security-model.md).

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
