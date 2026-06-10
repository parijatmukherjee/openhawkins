# OpenHawkins — Design & Plan

**Date:** 2026-06-05
**Status:** Draft for review
**Author:** Parijat Mukherjee (with Claude)
**Source pattern:** [`openclaw-hawkins`](../../../openclaw-hawkins) (multi-agent orchestration on top of the OpenClaw runtime)

---

## 1. One-paragraph thesis

OpenHawkins is **your personal AI assistant** — one brain, your devices. It runs on your PC, laptop, and phone, synchronized over your local network so your memory, context, and work follow you everywhere. **Your data never touches a cloud server.** The agent loop, model adapters, tool engine, durable state, and shared memory all live on your devices, talking to each other over encrypted local sync. The guiding principle: **the runtime enforces what models leave to chance** — tool-calling, grounding, state transitions, memory injection, permissions, and device routing. The model proposes; the runtime enforces. Your brain, everywhere.

---

## 2. Goals & non-goals

### Goals

1. **Own the runtime.** No dependency on the external OpenClaw gateway.
2. **Kill hallucination at the root** via a runtime-enforced _Grounding_ system
   (the user's #1 pain point: models hallucinate when they don't use tools, even
   with clear skill instructions).
3. **Cross-platform, installs anywhere, works perfectly** — Windows, macOS, Linux.
   No hard MariaDB dependency; zero-config default.
4. **Telegram + Discord native** as first-class chat channels.
5. **Beautiful, motion-rich dashboard** (Astro) replacing the Linear dependency
   for operator oversight — built with the `emil-design-eng`, `impeccable`, and
   `design-taste-frontend` skills.
6. **Feature parity with the openclaw-hawkins pattern**: Nexus orchestration,
   6 Tendrils, durable state (VINES), decay-aware memory (VECNA), operator
   oversight.
7. **Learning, auditable, shareable, ecosystem-compatible** — v1 ships
   deterministic replay + an eval harness, a per-Tendril learning loop, exportable
   "Pulse replay" artifacts, and `SKILL.md` skill-marketplace compatibility
   (§10.1). The platform improves over time, can prove what it did, and plugs into
   the existing skill ecosystem.
8. **Security & trust as a core pillar** — encrypted secrets, RBAC + sandboxing,
   prompt-injection defense, session integrity, tamper-evident audit, runtime-
   enforced approval, and identity disclosure (§5.5). Safety lives in the runtime,
   below the model — never in a config flag or a prose rule.
9. **Keep the strengths** of the source repo: TypeScript, strict typing, high
   test coverage, clean module boundaries.

### Non-goals (for v1)

- Writing a model _inference_ engine. We sit on top of provider SDKs
  (Anthropic / OpenAI / Ollama) and own everything _above_ the raw model call.
- A general-purpose agent _framework_ for third parties (we may expose a plugin
  API later, but v1 is a product, not a framework).
- Voice channels (future).
- Cloud hosting / SaaS / multi-tenancy. OpenHawkins is **one person's personal
  assistant**, not a hosted platform. Multi-device sync is device-to-device over
  the local network, never through a cloud server.
- Public API or external clients. The only network surface is encrypted device-to-device sync.
- Distributed/multi-host clustering in v1 (single-device default; multi-device sync
  is local-only, no relay).

---

## 3. Problems with OpenClaw / the source architecture (and how OpenHawkins fixes each)

This is the analysis the project was started to produce. Each problem below is
derived from reading the `openclaw-hawkins` source (`src/dispatcher.ts`,
`orchestrator/AGENTS.md`, `skills/`, `vines/`, `vecna/`).

| #       | Problem (OpenClaw / source)                                                                                                                                                  | Root cause                                                                                                                                                                                                 | OpenHawkins fix                                                                                                                                                                                                                                                                             |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1**  | **Models hallucinate when they don't call tools**, even with clear skill instructions.                                                                                       | Skills/`AGENTS.md` are _passive prose_ injected into context. Tool-use is _optional_ — the model decides. Weak local models (kimi-k2, gemma via ollama) answer from parametric memory. No grounding check. | **The Grounding engine** (§5) — runtime-enforced tool-required skills, claim-citation verification, structured outputs, and an "I-don't-know / call-a-tool" path. The runtime _rejects_ ungrounded final answers and re-prompts.                                                            |
| **P2**  | **Dispatch is subprocess-based and fragile.** `dispatchSpecialist` runs `openclaw agent … --json`, parses stdout.                                                            | Brittle: PATH/ENOENT, JSON parse failures, 16 MB buffer cap, no streaming, timeout = SIGTERM kill, no mid-flight cancellation.                                                                             | **In-process dispatch** over a typed message bus. Streaming token + tool-call events, cancellation, structured results — no subprocess, no stdout parsing.                                                                                                                                  |
| **P3**  | **No streaming / no progress.** Synchronous request→response with a hard timeout; the Nexus blocks on a subprocess.                                                          | The runtime has no event model.                                                                                                                                                                            | **Event-sourced runtime.** Every turn emits `token`, `tool_call`, `tool_result`, `phase`, `state` events over WebSocket to channels + dashboard.                                                                                                                                            |
| **P4**  | **Hard MariaDB dependency** for durability (VINES + VECNA).                                                                                                                  | Both subsystems require a MariaDB instance.                                                                                                                                                                | **Embedded SQLite default** (zero-config, cross-platform). SQLite on every device, synced device-to-device. No external database required.                                                                                                                                                   |
| **P5**  | **State & memory are bolt-ons the LLM must remember to call.** VINES/VECNA are CLIs the orchestrator invokes via bash; if the model forgets `vines set-state`, state drifts. | Durability depends on LLM discipline.                                                                                                                                                                      | **Runtime-owned state & memory.** The orchestrator engine writes state transitions automatically as it drives the Pulse. Memory is **auto-injected** each turn — no manual `vecna recall` paste.                                                                                            |
| **P6**  | **Operator oversight requires Linear** (third-party SaaS).                                                                                                                   | No built-in UI.                                                                                                                                                                                            | **Built-in Astro dashboard** + local event store. Linear/GitHub Issues become optional _exporters_, not the source of truth.                                                                                                                                                                |
| **P7**  | **Concurrency is prose, not enforced.** "No more than 2 dispatches", "sequential by default" live in `AGENTS.md`.                                                            | The model is asked to self-limit.                                                                                                                                                                          | **Runtime scheduler** with enforced concurrency limits, queueing, and backpressure.                                                                                                                                                                                                         |
| **P8**  | **Permissions are convention, not sandbox.** Tendrils are full agents with shell access; "never auto-send" is a prose rule.                                                  | No capability gating.                                                                                                                                                                                      | **Capability sandbox.** Each agent gets a typed, scoped tool surface enforced by the runtime. Side-effecting tools (send email, post to Discord) require an explicit approval gate the runtime mediates.                                                                                    |
| **P9**  | **Linux-only assumptions.** `system-agent` = apt/systemd/ufw/cron; `setup.sh` is bash; paths assume `~/.openclaw`.                                                           | Built for one OS.                                                                                                                                                                                          | **OS-abstraction layer.** Platform detection; package-manager abstraction (apt/brew/winget/choco); pwsh vs bash; OS-appropriate config dirs (XDG / AppData / Library).                                                                                                                      |
| **P10** | **No typed tool contract at the engine boundary.** Tool calls are free-form bash via `exec`; TypeBox validation exists only inside the plugin.                               | Tools aren't first-class at the runtime.                                                                                                                                                                   | **Typed tool registry.** Every tool has a JSON-schema (TypeBox/Zod) for args + result; the runtime validates both directions and feeds schemas to the model as native tool definitions.                                                                                                     |
| **P11** | **Manual memory injection.** VECNA recall must be pre-fetched and pasted into the prompt.                                                                                    | Context assembly is the model's job.                                                                                                                                                                       | **Automatic context assembly.** The runtime retrieves relevant memory (topic + embedding similarity) and injects it into the system prompt before each turn.                                                                                                                                |
| **P12** | **No observability / eval / replay.** Post-mortem = reading `.jsonl` session files by hand.                                                                                  | No trace store.                                                                                                                                                                                            | **Trace store + replay.** Token accounting, cost, latency per orchestration; deterministic replay; eval harness. Surfaced in the dashboard.                                                                                                                                                 |
| **P13** | **Credential & data exposure.** Secrets/API keys in plain-text `.env` under `~/.openclaw`; documented active exploits; no encrypted storage.                                 | No secrets management.                                                                                                                                                                                     | **Encrypted credential vault.** Secrets live in the OS keychain (macOS Keychain · Windows Credential Manager · libsecret) or an age/libsodium-encrypted vault unlocked by a master key — **never plaintext on disk**. Optional 1Password/Vault backends. Config files refuse secret values. |
| **P14** | **No access-control boundaries (no RBAC).** Granting the agent your creds gives it all your permissions; a compromised agent moves laterally — its shell is your shell.      | No privilege separation.                                                                                                                                                                                   | **RBAC + least-privilege isolation.** Per-agent roles and capability grants (extends P8). Tendrils run in constrained sandboxes (restricted child process / OS sandbox / optional container), **not** as ambient you. Default-deny; explicit scoped grants only.                            |
| **P15** | **Indirect prompt injection.** External content (WhatsApp/web/email/attachments) carries hidden instructions the LLM treats as system commands.                              | No data/instruction separation.                                                                                                                                                                            | **Untrusted-content firewall.** All externally-ingested content is fenced as _data, never instructions_, with provenance tags. Injection heuristics + a "tainted input ⇒ side-effecting actions require approval" rule. Tool calls triggered by tainted content are gated and logged.       |
| **P16** | **State/session corruption.** Long async tool calls or concurrent messages bypass the command queue's serialization → conflicting tool outputs.                              | Weak concurrency model.                                                                                                                                                                                    | **Single-writer per session.** Each session is a serialized actor over the event-sourced log (extends P7); transactional state transitions, idempotency keys, optimistic locking. Concurrency happens _across_ sessions, never _within_ one.                                                |
| **P17** | **Inadequate audit logging.** Local conversation logs only; no tamper-evident, centralized trail for debugging/compliance.                                                   | Logs aren't auditable.                                                                                                                                                                                     | **Tamper-evident audit log.** Append-only, hash-chained record of every decision, tool call, state transition, and approval — exportable for compliance, queryable in the dashboard (extends P12 with integrity).                                                                           |
| **P18** | **Unpredictable autonomy.** Background heartbeat daemon may fire high-risk actions (send email, modify files) without final approval if guardrails are off/misconfigured.    | Autonomy not runtime-gated.                                                                                                                                                                                | **Runtime-enforced approval gates + autonomy levels.** Side-effecting actions are risk-classified; high-risk = default human-in-the-loop, mediated by the runtime (not a config flag the model can ignore). Dry-run mode; per-action autonomy policy.                                       |
| **P19** | **Skill conflicts & brittleness.** Global vs workspace `SKILL.md` collide; agent picks the wrong tool or loops.                                                              | No deterministic resolution.                                                                                                                                                                               | **Deterministic skill resolution.** Explicit precedence + namespacing + scoping; conflict detection at load time; loop/circuit-breaker detection in the agent loop.                                                                                                                         |
| **P20** | **Configuration friction.** Maintenance means hand-debugging YAML/Markdown; non-technical users can't fix broken integrations.                                               | Untyped, hand-edited config.                                                                                                                                                                               | **Typed config + dashboard-driven settings.** Schema-validated config with migrations; integration health checks + a `doctor` that self-diagnoses; no hand-editing required for common changes.                                                                                             |
| **P21** | **Resource & energy drain.** Persistent polling, heartbeats, and heavy local work (audio transcription, etc.) tax laptops.                                                   | Busy-poll architecture.                                                                                                                                                                                    | **Event-driven, not polling.** Webhook/long-poll channel intake; lazy on-demand tendril spawning with idle suspension; resource budgets; offload heavy media tasks.                                                                                                                         |
| **P22** | **Impersonation risk.** Recipients on Telegram/Slack/WhatsApp can't tell agent from human; unintended commitments.                                                           | No identity disclosure.                                                                                                                                                                                    | **Mandatory identity disclosure.** Outbound messages are signed/labeled as the assistant (configurable), never as the user (extends the source `comm-agent` rule into a runtime guarantee); outbound audit trail.                                                                           |

---

## 4. Architecture

A single TypeScript monorepo (pnpm/npm workspaces), distributed as a
**single binary per OS**. Everything in-process; the only external processes are
optional (an Ollama server, an opt-in Postgres/MariaDB).

```
                         ┌───────────────────────────────────────┐
        user ───────────►│  CHANNELS  (Telegram · Discord · CLI · │
                         │            WebSocket for dashboard)     │
                         └───────────────────┬───────────────────┘
                                             │ typed session messages
                         ┌───────────────────▼───────────────────┐
                         │      ORCHESTRATOR  (the Nexus)         │
                         │  routing · Pulse engine · synthesis    │
                         │  (logic in code — not prose AGENTS.md) │
                         └───────┬───────────────────────┬───────┘
                                 │ in-process dispatch    │ auto state/memory
              ┌──────────────────┼──────────┐            │
        ┌─────▼────┐ ┌────▼────┐ ┌────▼─────┐ …          │
        │ system   │ │ code    │ │ research │  TENDRILS  │
        │ tendril  │ │ tendril │ │ tendril  │ (in-proc)  │
        └────┬─────┘ └────┬────┘ └────┬─────┘            │
             │ every agent runs on ↓  │                  │
       ┌─────▼──────────────────────────────────────┐    │
       │  CORE RUNTIME                               │    │
       │  • agent loop (turn = think→tools→answer)   │    │
       │  • model adapters (Anthropic/OpenAI/Ollama) │    │
       │  • typed tool registry + native tool-calling│    │
       │  • GROUNDING engine  ◄── kills hallucination │   │
       │  • capability sandbox + approval gates      │    │
       │  • event bus (token/tool/phase/state)       │    │
       └─────────────────────┬───────────────────────┘    │
                             │                             │
       ┌─────────────────────▼─────────────────────────────▼──────┐
       │  STATE (VINES)             │   MEMORY (VECNA)             │
       │  durable orchestration row │   decay-aware shared memory  │
       │  runtime-owned transitions │   auto-injected each turn    │
       │  SQLite per device          │   SQLite+embeddings per device│
       └──────────────────────────────────────────────────────────┘
                             │
              ┌──────────────▼──────────────┐
              │  SYNC ENGINE (Track B)       │
              │  • mDNS device discovery    │
              │  • Noise encrypted sync      │
              │  • CRDT conflict resolution  │
              │  • master device election    │
              └──────────────┬──────────────┘
                             │ encrypted device-to-device
              ┌──────────────▼──────────────┐
              │  YOUR DEVICES                │
              │  PC · Laptop · Phone · Tablet │
              │  (all share one brain)       │
              └─────────────────────────────┘
                             │
              ┌──────────────▼───────────────┐
              │  DASHBOARD (Astro, motion-rich)│  ◄── real-time over WebSocket
              │  Pulse board · tendrils · mem  │
              │  traces · cost · replay        │
              └────────────────────────────────┘
```

### 4.1 Packages

| Package                     | Responsibility                                                                                                                                                          | Key deps                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `@openhawkins/core`         | Agent loop, model adapters, typed tool registry, **Grounding engine**, capability sandbox, event bus                                                                    | `@anthropic-ai/sdk`, `openai`, ollama client, `zod`/`typebox` |
| `@openhawkins/state`        | VINES reborn — durable orchestration ledger, runtime-owned transitions, recovery (SQLite per device)                                                                                        | `better-sqlite3`                                           |
| `@openhawkins/memory`       | VECNA reborn — fragments, decay ranking, embeddings, auto-injection (SQLite per device)                                                                                                     | sqlite-vec / local embeddings                                 |
| `@openhawkins/sync`       | **Track B** — device identity, local-first sync, CRDT, mDNS discovery, Noise encrypted sync, cross-device task routing                                                                       | `@openhawkins/state`, `@openhawkins/memory`                  |
| `@openhawkins/tickets`      | **The Board** — operator ticket tracking (Cases); replaces Linear; SQLite-backed                                                                                        | state store                                                   |
| `@openhawkins/orchestrator` | The Nexus — routing, the Pulse engine (in code), synthesis                                                                                                              | core, state, memory, tickets                                  |
| `@openhawkins/tendrils`     | 6 specialist agent definitions + scoped tool surfaces                                                                                                                   | core                                                          |
| `@openhawkins/channels`     | Telegram (grammY), Discord (discord.js), CLI, WebSocket adapters                                                                                                        | grammY, discord.js, ws                                        |
| `@openhawkins/dashboard`    | Astro app — real-time operator UI                                                                                                                                       | Astro, view-transitions, motion lib                           |
| `@openhawkins/gateway`      | The daemon: wires channels↔orchestrator↔core, serves dashboard + WS                                                                                                     | fastify/hono                                                  |
| `@openhawkins/plugin-sdk`   | The **public extension contract** — types + helpers third parties build against (Tendrils, tools, channels, model adapters, storage drivers, dashboard widgets, skills) | core types only                                               |
| `@openhawkins/registry`     | Plugin loader + resolver + capability gating + (future) marketplace client                                                                                              | plugin-sdk, core                                              |
| `@openhawkins/cli`          | `openhawkins` command (start/stop/config/agent/**plugins**/doctor)                                                                                                      | commander                                                     |

### 4.2 Why in-process beats subprocess dispatch

The single biggest structural change from the source. Subprocess dispatch
(`execFile('openclaw', …)`) cannot stream, cannot cancel cleanly, caps output at
16 MB, and turns every failure into an opaque exit code. In-process agents share
a typed event bus: the orchestrator sees every token and tool call live, can
cancel, can enforce concurrency, and never parses stdout. The
`DispatchResult` contract from the source survives as a typed interface.

---

## 5. The Grounding engine — the anti-hallucination centerpiece

This is the feature that directly answers the user's pain point. It is a stack
of runtime-enforced layers, not a prompt.

1. **Native tool-calling, not prose.** Tools are registered with JSON schemas and
   handed to the model via provider-native function/tool-calling
   (Anthropic tool use, OpenAI tools, Ollama tool calling). The model emits a
   structured tool call; the runtime validates args against the schema and
   executes. No "remember to run `df`" hope-and-pray.

2. **Tool-required skills.** A skill manifest can declare
   `grounding: required` (optionally naming specific tools). For such a task the
   runtime **will not accept a final answer until at least one qualifying tool
   call has succeeded.** If the model tries to answer first, the runtime injects
   a corrective turn: _"You must call `<tool>` before answering."_

3. **Claim-citation verification.** For factual/data answers the final message
   must reference tool-result IDs. A cheap verification pass (rules + a small
   model) checks that asserted facts trace to a tool output. Ungrounded claims
   are flagged, and the runtime either strips them or forces a re-grounding turn.

4. **Structured outputs.** When the answer is data (a status, a count, a table),
   the runtime forces a JSON-schema response so the model fills fields from tool
   outputs rather than composing prose it can fabricate.

5. **Explicit "unknown" path.** Skills instruct: _prefer calling a lookup/search
   tool, or return `unknown`, over guessing._ The runtime treats a grounded
   "unknown" as success, not failure — removing the incentive to fabricate.

6. **Model tiering.** Grounding-critical tasks route to stronger models; cheap
   local models handle only low-stakes chat. The adapter layer makes tier a
   policy, not a hard-coded model id.

7. **Optional verifier agent.** For high-stakes orchestrations, a second pass
   (separate agent) adversarially checks the first's claims against tool outputs
   before the Nexus reports — mirroring the "verification-before-completion"
   discipline.

**Acceptance test for the Grounding engine (Subproject 1 exit criteria):** a
deliberately under-instructed agent asked a question it would normally fabricate
(e.g. "how much disk is free?") must be _unable_ to answer without calling the
disk tool, and its answer must cite the tool result — verified by an automated
test on all three OSes.

---

## 5.5 Security, Trust & Safety model

OpenClaw's most serious failures are not functional — they are security and
trust failures (P13–P22). OpenHawkins treats security as a **core runtime
pillar**, designed alongside the Grounding engine, not bolted on. The unifying
principle mirrors Grounding: **the runtime enforces safety; it is never left to
the model's discretion or a config flag.**

The model can be tricked (prompt injection), the daemon can run unattended, and
plugins are untrusted — so the safety boundary lives in the runtime, below the
model.

### 5.5.1 Secrets — encrypted, never plaintext (P13)

- Secrets resolve from the **OS keychain** (macOS Keychain · Windows Credential
  Manager · Linux libsecret/Secret Service) or an **age/libsodium-encrypted
  vault** unlocked by a master key/passphrase.
- **Config files refuse secret values** (continues the source's secrets policy,
  hardened). Nothing sensitive is ever written plaintext to `~`.
- Optional enterprise backends: 1Password CLI, HashiCorp Vault.

### 5.5.2 Privilege separation & RBAC (P14)

- **Least privilege per agent.** Each Tendril/plugin gets a typed capability
  grant; the runtime denies anything outside it (shared mechanism with §8.5.3).
- **Sandboxed execution.** Tendril tool handlers run in constrained workers
  (restricted child processes; optional OS sandbox/container) — the agent's shell
  is **not** the user's shell.
- **RBAC roles** map operators → permitted agents/tools/approval authority, so a
  compromised agent can't move laterally.

### 5.5.3 Untrusted-content firewall — prompt-injection defense (P15)

- All externally-ingested content (chat messages, web pages, files, attachments)
  is **tagged with provenance** and **fenced as data, never instructions** in the
  prompt assembly layer.
- **Taint rule:** any action _influenced by_ untrusted content that is also
  _side-effecting_ (send, delete, pay, exec) is force-gated through an approval
  step and audit-logged — even in autonomous mode.
- Injection heuristics flag suspicious instruction-like patterns in ingested data.

### 5.5.4 Session integrity (P16)

- **One writer per session.** Each session is a serialized actor over the
  event-sourced log; transitions are transactional with idempotency keys and
  optimistic locking. Parallelism is _across_ sessions, never _within_ one — so
  async tool calls can't corrupt session state.

### 5.5.5 Tamper-evident audit (P17)

- An **append-only, hash-chained** audit log records every decision, tool call,
  state transition, approval, and outbound message. Integrity is verifiable;
  the log is exportable for compliance and queryable/replayable in the dashboard.

### 5.5.6 Autonomy & approval (P18)

- Side-effecting actions are **risk-classified**. High-risk defaults to
  **human-in-the-loop**, enforced by the runtime — not a config flag the model or
  a misconfiguration can bypass. Approval surfaces as a channel button (Telegram/
  Discord) or a dashboard prompt. Dry-run mode and per-action autonomy policy.

### 5.5.7 Identity disclosure — anti-impersonation (P22)

- Outbound messages are **labeled/signed as the assistant** by default, never as
  the user — a runtime guarantee, not a prose rule. Per-channel disclosure config
  and a full outbound audit trail.

### 5.5.8 Threat model (summary)

| Adversary                   | Vector                      | Primary defense                                           |
| --------------------------- | --------------------------- | --------------------------------------------------------- |
| Local attacker reading disk | Plaintext secrets           | Encrypted vault / OS keychain (§5.5.1)                    |
| Compromised agent           | Lateral movement            | RBAC + sandboxing (§5.5.2)                                |
| Malicious content author    | Indirect prompt injection   | Untrusted-content firewall + taint gating (§5.5.3)        |
| Malicious/buggy plugin      | Capability abuse            | Declared-capability sandbox + install disclosure (§8.5.3) |
| Unattended daemon           | Unapproved high-risk action | Runtime approval gates (§5.5.6)                           |
| Repudiation / debugging     | No trail                    | Tamper-evident audit (§5.5.5)                             |

These defenses are **designed in S1** (vault interface, capability model, taint
tags, single-writer sessions, audit log) so later subprojects inherit a safe
core rather than retrofitting one.

---

## 6. Cross-platform strategy

- **TypeScript everywhere**; single-binary build per OS (Bun `--compile` or Node
  SEA — decided in Subproject 1 after a spike; both keep the TS source).
- **Embedded SQLite default** (`better-sqlite3` or `bun:sqlite`) → no MariaDB
  install required. The source's MariaDB schemas port to SQLite; PG/MariaDB stay
  available via a storage-driver interface for multi-host operators.
- **OS-abstraction layer** in `core`:
  - platform detection; package-manager abstraction
    (`apt`/`dnf` · `brew` · `winget`/`choco`);
  - shell abstraction (bash/zsh vs PowerShell);
  - config/data dirs via OS conventions (XDG on Linux, `Library/Application
Support` on macOS, `%APPDATA%` on Windows).
- **`system-agent` becomes OS-aware**: the Linux-only "apt/systemd/ufw/cron"
  scope generalizes; the agent inspects the host and picks the right commands.
- **Installers:** Homebrew tap, Scoop/winget manifest, `curl | sh`, and `npm i -g`.

### 6.1 Model selection — free, cross-platform, chosen at setup (Cerebro + Mr. Clarke)

No paid account is required to run OpenHawkins. The **setup wizard ("Mr. Clarke")**
asks the operator to tune **Cerebro** (the model layer) to one of several free,
cross-platform options:

| Option                         | What                                                                                | Notes                                                                                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Local / Ollama** _(default)_ | Fully free, private, offline-capable; runs on Win/Mac/Linux                         | Wizard offers a small capable default (e.g. a Llama/Qwen-class model) and checks hardware                                                         |
| **Ollama cloud** _(v1)_        | Ollama-hosted models (e.g. the source's `…:cloud` tags) — no local hardware needed  | Same Ollama adapter/API surface as local; user supplies an Ollama key, stored in **The Cabin**. Great for laptops that can't run big local models |
| **Free cloud tier**            | A provider with a no-cost tier (e.g. Google Gemini / Groq / OpenRouter free models) | User pastes a free API key; stored encrypted in **The Cabin** (§5.5.1)                                                                            |
| **Bring your own**             | Anthropic / OpenAI / any provider                                                   | Opt-in; unlocks stronger grounding-tier routing                                                                                                   |

The **Ollama adapter must support both local and `…:cloud` models in v1** behind a
single code path — local vs cloud is a config/endpoint choice, not a separate
integration (this mirrors how the source used `ollama/kimi-k2.6:cloud`).

The adapter layer is **provider-agnostic** — model choice is policy, not
hard-coded. **Important synergy:** weaker free models hallucinate _more_, which is
exactly why the **Grounding engine (Eleven, §5)** is mandatory, not optional — it
is the mitigation that makes free local models trustworthy. Grounding-critical
steps can be routed to a stronger model (incl. Ollama cloud) if configured.

### 6.2 Cross-platform tendrils (esp. `system-agent`)

The six functional ids are kept, but `system-agent` is redefined from Linux-only
sysadmin to an **OS-aware host agent**: it inspects the host and selects the right
package manager (`winget`/`choco` · `brew` · `apt`/`dnf`), the right shell
(PowerShell vs bash/zsh), and cross-platform service control — via the
OS-abstraction layer above. The other tendrils (`code`, `research`, `data`,
`comm`, `vision`) are already platform-neutral.

---

## 7. Channels: Telegram + Discord

- **Telegram** via grammY (modern, typed). **Discord** via discord.js.
- Each channel maps a chat/thread → an orchestrator **session** (multi-turn,
  resumable). Streaming replies (edit-in-place message updates as tokens arrive).
- **Approval gates** surface as inline buttons: the `comm-agent`'s "draft → send
  it?" becomes a Telegram/Discord button the runtime mediates — no auto-send.
- **Media passthrough:** images/files routed to the `vision-agent`.
- A `telegram` Claude-Code plugin already exists in this environment and can seed
  patterns (token storage, allowlist/policy), but OpenHawkins ships its own
  channel adapters.

---

## 8. Dashboard (Astro, motion-rich)

Built with the three installed design skills — **`emil-design-eng`** (motion &
polish), **`impeccable`** (anti-AI-slop design language), **`design-taste-frontend`**
(metric-based component architecture).

Views:

- **The Pulse board** — live orchestrations through the 5 phases (Sensitivity →
  Anchoring → Deep Seeking → Connection → Consolidation), animated transitions.
- **Tendrils** — per-specialist activity, current task, token/latency.
- **Memory (VECNA)** — browse/search fragments, importance, decay, evolution graph.
- **Traces & replay** — step through any orchestration; token + cost accounting.
- **Settings** — models, channels, capability/approval policy.

Design intent: real-time, fluid, sub-300ms interactions, custom easing, no
generic AI-dashboard look. Replaces Linear as the oversight surface (Linear/GitHub
become optional exporters).

---

## 8.5 Plugin system & marketplace

OpenHawkins is **extensible by design** and aims, in the future, to host a
**community marketplace** where authors submit plugins. This is not a v1
afterthought — it shapes the runtime now, because a stable, versioned extension
contract and a real capability sandbox must exist _before_ third-party code runs
on a user's machine.

### 8.5.1 What is a plugin?

A plugin is a versioned package that contributes one or more **extension points**:

| Extension point      | Example                                                     |
| -------------------- | ----------------------------------------------------------- |
| **Tendril**          | A new specialist agent (e.g. `media-agent`, `devops-agent`) |
| **Tool**             | A typed, schema-validated capability an agent can call      |
| **Channel**          | A new chat front-end (Slack, WhatsApp, Matrix, SMS)         |
| **Model adapter**    | A new provider (Gemini, Groq, Bedrock, a local server)      |
| **Storage driver**   | A new state/memory backend (Postgres, Redis, S3)            |
| **Dashboard widget** | A new panel/visualization in the Astro UI                   |
| **Skill**            | A grounding-aware skill manifest (`SKILL.md`-compatible)    |

### 8.5.2 Plugin manifest

Every plugin ships an `openhawkins.plugin.json` (echoing the source repo's
`openclaw.plugin.json`) declaring:

- `id`, `version`, `author`, `license`, `description`;
- `contributes`: which extension points + entry modules;
- `capabilities`: the **declared permission set** it needs (`shell`, `network`,
  `filesystem:read`, `filesystem:write`, `send-message`, `model-call`, …);
- `config`: a JSON schema for its settings (secrets refused — env-only, per the
  source's secrets policy);
- `compat`: supported OpenHawkins version range.

### 8.5.3 Capability sandbox (the safety foundation — ties to P8)

Third-party code is **untrusted**. The runtime enforces:

- **Declared-capability gating.** A plugin can only use capabilities it declared;
  the runtime denies anything outside its grant at call time.
- **Install-time disclosure.** Before install, the user sees exactly what the
  plugin asks for — _"this plugin wants: shell, network, send-message"_ — in the
  CLI and the dashboard. No silent escalation.
- **Approval gates for side-effects.** Network/shell/send-message calls from a
  plugin route through the same runtime-mediated approval gates as the
  `comm-agent` "send it?" flow.
- **Isolation.** Plugin tool handlers run with a constrained API surface (no
  ambient `process`/`fs` access — only the injected, capability-scoped host API).

### 8.5.4 Loading & distribution (v1)

- **Local dir** — drop a plugin folder in the OpenHawkins plugins path.
- **npm** — `openhawkins plugins install npm:<pkg>`.
- **Skill compatibility** — read the same `SKILL.md` format the Claude `skills`
  CLI uses (the format used to install `emil-design-eng`, `impeccable`,
  `design-taste-frontend` for this very project), so the existing skill ecosystem
  drops in.

### 8.5.5 The marketplace (future phase)

A hosted registry (the OpenHawkins analogue of npm / the source's "ClawHub"):

- **Submission flow:** author publishes → automated **manifest validation** +
  **security scan** (static capability audit, dependency check) → versioned,
  **signed** package.
- **Trust & safety:** signed packages; capability disclosure surfaced at install;
  a review/curation process; report/takedown path; semver + deprecation.
- **Discovery:** browse/search in the dashboard ("Marketplace" view) and via
  `openhawkins plugins search <query>`; ratings, install counts.
- **Optional monetization** (paid/private plugins) — left open, not v1.

The marketplace is **deferred to its own phase (M1, §9)**, but the **plugin SDK,
loader, and capability sandbox are v1** so that everything above is possible
without a breaking redesign later.

---

## 9. Decomposition & build order

Each subproject gets its own spec → plan → implementation cycle. This document is
the umbrella; do **not** try to implement it all from one plan.

| #                 | Subproject                                   | Deliverable                                                                                                                                                                                                                                                                   | Why this order                                                                                                                                   |
| ----------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S0**            | **Repo + monorepo scaffold + this Plan**     | Git repo, workspace skeleton, CI, this design doc                                                                                                                                                                                                                             | Foundation for everything (in progress)                                                                                                          |
| **S1**            | **Core runtime + Grounding engine**          | Model adapters (incl. **Ollama local + cloud**) + agent loop + typed tool registry + Grounding, **event-sourced recording + deterministic replay + eval harness** (§10.1), proven by a thin vertical slice (1 agent, 1 tool, grounding enforced, replayable) on Win/Mac/Linux | The foundation **and** the direct fix for the #1 pain point. Highest value, highest risk → first. Replay/eval must be designed in from turn one. |
| **S2**            | **State + Memory (SQLite-default)**          | VINES + VECNA reborn, runtime-owned, auto-injected, **+ per-Tendril learning loop** (§10.1)                                                                                                                                                                                   | Orchestrator depends on these; learning loop closes P11                                                                                          |
| **S3**            | **Orchestrator + Tendrils**                  | The Nexus (Pulse in code) + 6 specialists, in-process dispatch                                                                                                                                                                                                                | The pattern itself                                                                                                                               |
| **S4**            | **Channels + Gateway**                       | Telegram + Discord + CLI + WS daemon                                                                                                                                                                                                                                          | Makes it usable by humans                                                                                                                        |
| **S5**            | **Dashboard**                                | Astro real-time motion-rich UI **+ "Pulse replay" shareable HTML artifacts** (§10.1)                                                                                                                                                                                          | Operator oversight (replaces Linear)                                                                                                             |
| **S6**            | **Plugin SDK + loader + capability sandbox** | `plugin-sdk` + `registry`: load local/npm plugins, **`SKILL.md` skill-marketplace compatibility** (§10.1), declared-capability gating, install-time disclosure                                                                                                                | Makes the platform extensible; **prerequisite for the marketplace**                                                                              |
| **S7**            | **Cross-platform packaging**                 | Single-binary builds + installers for 3 OSes                                                                                                                                                                                                                                  | Ship it                                                                                                                                          |
| **M1** _(future)_ | **Hosted marketplace**                       | Registry, submission + security-scan + signing flow, dashboard "Marketplace" view                                                                                                                                                                                             | Community plugin ecosystem (needs S6 contracts stable first)                                                                                     |

> **Note:** the _plugin contract_ (the `plugin-sdk` types) and the _capability
> sandbox_ are designed in S1 alongside the tool registry, even though the full
> loader lands in S6 — so third-party safety isn't retrofitted onto an unsafe core.

**Recommended next step after this plan is approved:** spec **S1** in detail, then
implement a walking-skeleton vertical slice that demonstrates the Grounding engine
ending hallucination on a real task.

---

## 10. Scope

### 10.1 Promoted into v1 (committed)

These four are **v1 features**, not future ideas — they are cheap to design in now
and expensive to retrofit, and together they make the platform _learning,
auditable, and shareable_. Each is anchored to the subproject that owns it.

- **Deterministic replay & eval harness** _(owned by S1, built on the event-
  sourced runtime)_ — every turn (prompt, tool call, tool result, model output) is
  recorded so any orchestration can be **replayed deterministically** to debug, to
  A/B a prompt/model change, and to regression-test agent behavior. The eval
  harness runs recorded scenarios as automated tests — and is the natural home for
  the **Eleven** grounding acceptance tests (§5). Builds directly on **Murray**
  (§5.5.5) and the trace store (P12).
- **Per-Tendril learning loop** _(owned by S2, **VECNA**)_ — memory fragments are
  tagged by tendril; on each dispatch the runtime auto-injects that specialist's
  own accumulated lessons, so each Tendril measurably improves its future
  grounding over time (closes the loop on P11). Includes a feedback signal from
  approval/audit outcomes back into fragment importance.
- **"Pulse replay" as shareable artifacts** _(owned by S5, dashboard)_ — export
  any orchestration as a **self-contained, animated HTML trace** (the Pulse phases,
  tendril dispatches, tool calls, grounding decisions) that can be shared/opened
  offline. Uses the same replay data as the eval harness.
- **Skill-marketplace compatibility** _(owned by S6, **The AV Club**)_ — read the
  same `SKILL.md` format the `skills` CLI uses (the format used to install
  `emil-design-eng` / `impeccable` / `design-taste-frontend` for this project), so
  the existing community skill ecosystem drops into OpenHawkins directly, and
  **Melvald's** (M1) can host them.

### 10.2 Future / not committed

- **MCP support** — OpenHawkins as both an MCP _client_ (consume external tools)
  and an MCP _server_ (expose Tendrils to other agents). Huge interop win.
- **Cost & token budgets per orchestration**, enforced by the scheduler (hard cap
  → graceful stop), surfaced live in the dashboard.
- **Local-first / offline mode** — fully functional with local Ollama, no cloud.

---

## 11. Decisions (resolved 2026-06-05)

1. **Binary toolchain — Bun `--compile`.** Confirmed lean; validate with a spike
   in S1 (fall back to Node SEA only if a native-dep blocker appears).
2. **Model defaults — free + cross-platform, chosen during setup.** No paid
   provider is required to run. The **setup wizard (Mr. Clarke / Cerebro, §6.1)**
   asks the user to pick from several free, cross-platform options; default is
   local **Ollama** (free, private, runs on Win/Mac/Linux). Paid providers are
   opt-in for those who want stronger grounding-tier models. See §6.1.
3. **Schema lib — Zod.** Chosen for DX and clean JSON-schema generation for
   native tool-calling (`zod-to-json-schema`). The TypeBox usages in the copied
   reference code are **migrated to Zod** during the port (we own the code now;
   we won't carry two schema libs). _Override possible if continuity wins._
4. **Tendril set — adjusted for cross-platform.** Keep the six functional ids, but
   redefine `system-agent` from Linux-only sysadmin to an **OS-aware host agent**
   (winget/choco · brew · apt/dnf; PowerShell vs bash; cross-platform service
   control). See §6.2.
5. **Linear — dropped.** Replaced by an **own ticket-tracking system, "The Board"**
   (functional id `tickets`; tickets are _Cases_), backed by the local SQLite
   store and surfaced in the dashboard. Optional GitHub/Linear _exporters_ may be
   added later, but they are never the source of truth. The Pulse "Anchoring"
   phase now opens a **Case on The Board** instead of a Linear ticket.
6. **License — MIT** (matches the source). `LICENSE` added.

> **Naming:** all subsystems keep the **Stranger Things** theme per
> [`docs/branding.md`](../branding.md) — e.g. the Grounding engine is **Eleven**,
> the firewall is **The Gate**, the sandbox is **The Lab**, the vault is **The
> Cabin**, approvals are **Hopper**, audit is **Murray**, tickets are **The
> Board**, models are **Cerebro**, channels are **Supercomm**, the plugin layer
> is **The AV Club**, the future marketplace is **Melvald's**, setup is **Mr.
> Clarke**. _Brand the prose, not the protocol._

---

## 12. What this plan deliberately keeps from `openclaw-hawkins`

- The **Nexus + Tendrils** mental model and the **5-phase Pulse**.
- **VINES** (durable state) and **VECNA** (decay-aware memory) as concepts — but
  reborn as runtime-owned, SQLite-default, auto-driven subsystems.
- The **TypeScript + strict-typing + high-coverage** engineering culture.
- The **Stranger-Things-flavored vocabulary** is optional branding; the protocol
  is the substance.
