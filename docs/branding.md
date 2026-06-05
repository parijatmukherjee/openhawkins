# Branding — OpenHawkins

Canonical brand reference for **OpenHawkins**. It inherits the `openclaw-hawkins`
brand (the *Stranger Things* / Hawkins, Indiana motif) and **extends it to the new
subsystems** this project introduces.

> **Tagline:** _Everything is Connected._
> **Governing rule:** _Brand the prose, not the protocol._ — functional ids, CLI
> binaries, table names, and env vars stay technical and stable; the Stranger
> Things names are **aliases used in narrative prose, logs, and UI copy**.

---

## 1. Inherited vocabulary (unchanged)

| Brand term | Meaning | Functional id |
| --- | --- | --- |
| **The Nexus** | The orchestrator — operator's only conversational endpoint | `orchestrator` |
| **The Tendrils** | The specialist agents | `*-agent` |
| **The Hive** | The persistence layer (the "Upside Down" — memory that survives) | state + memory stores |
| **VINES** | Durable orchestration state | `state` |
| **VECNA** | Decay-aware shared memory | `memory` |
| **The Pulse** | The dispatch protocol (5 phases) | the orchestration engine |

The Pulse phases keep their brand aliases: **Sensitivity Check** (triage),
**Anchoring** (open a Case — see below), **Deep Seeking** (research), **The
Connection** (dispatch), **Consolidation** (synthesis).

---

## 2. New vocabulary (OpenHawkins subsystems)

These name the capabilities OpenHawkins adds over the source. Each has a stable
functional id (the protocol) and a Stranger Things brand alias (the prose).

| Brand alias | Functional id | Subsystem | Why this name |
| --- | --- | --- | --- |
| **Eleven** | `grounding` | The anti-hallucination Grounding engine | Eleven perceives the truth and keeps reality intact — the engine keeps the agent in the **Right Side Up** (tool-verified reality) instead of the fabricated **Upside Down**. |
| **The Gate** | `firewall` | Untrusted-content firewall (prompt-injection defense) | The boundary the Upside Down leaks through. The firewall controls what crosses from untrusted external input into the agent's reasoning. |
| **The Lab** | `sandbox` | Capability sandbox + RBAC | Hawkins National Laboratory — controlled containment of dangerous capabilities. |
| **The Cabin** | `vault` | Encrypted secrets vault | Hopper's hidden cabin where the secret (Eleven) is kept locked away and safe. |
| **Hopper** | `approvals` | Runtime-enforced approval gates / autonomy control | The Chief who must sign off before high-risk action is taken. |
| **Murray** | `audit` | Tamper-evident, hash-chained audit log | Murray Bauman, the meticulous investigator who records and verifies everything. |
| **The Board** | `tickets` | Operator ticket tracking (replaces Linear). Tickets are **Cases**. | The Party's investigation board where every mystery (request) is pinned and tracked to resolution. |
| **Cerebro** | `models` | Model adapters + provider selection | Dustin's giant radio tower for reaching distant signals — tune Cerebro to reach different model providers/"frequencies." |
| **Supercomm** | `channels` | Chat channels (Telegram, Discord, CLI, WS) | The kids' walkie-talkie network — how the Party stays in contact. |
| **The AV Club** | `plugin-sdk` + `registry` | Plugin SDK + loader | Hawkins Middle's AV Club, where Mr. Clarke's students build and wire up new gadgets (capabilities). |
| **Melvald's** | marketplace (M1) | Hosted plugin marketplace (future) | Melvald's General Store — where you go to get supplies (submit/discover/install plugins). |
| **Mr. Clarke** | `setup` / `doctor` | Setup wizard + self-diagnostics | The science teacher who patiently explains how everything works and helps you fix it. |

### Reserved phrases (extends the source list)
| Phrase | When |
| --- | --- |
| _"The Hive remembers."_ | Memory recall returned useful context. |
| _"Connecting to the Web…"_ | Dispatching to a Tendril. |
| _"Staying in the Right Side Up."_ | The Grounding engine forced a tool call instead of a guess. |
| _"The Gate holds."_ | The firewall fenced/flagged untrusted content. |
| _"Hopper needs to sign off."_ | A high-risk action is awaiting approval. |
| _"Pinning to the Board."_ | Opening a Case (the Anchoring phase). |

Use sparingly — once per phase per request.

---

## 3. Visual language (inherited)

| Role | Name | Hex |
| --- | --- | --- |
| Primary | **Pulse Red** | `#E60000` |
| Background | **Void Black** | `#000000` |
| Tertiary | **Vascular Maroon** | `#4A0E0E` |

Imagery: interconnected neural webs, vines tangled around nodes, clock-face
motifs, high contrast (black surfaces, red linework, occasional maroon glow).
Pulse Red is an **accent, not a fill**. No greens/blues/yellows or pastels.

The motion-rich dashboard (built with `emil-design-eng`, `impeccable`,
`design-taste-frontend`) renders this palette: Void Black surfaces, Pulse Red for
live/anomaly states and active Pulse phases, Vascular Maroon for hover/receding
elements.

---

## 4. What is intentionally NOT branded

Per _brand the prose, not the protocol_:

- **Agent ids** (`system-agent`, `code-agent`, …) — stable identifiers.
- **CLI binary** (`openhawkins`) and subcommands — short, ergonomic.
- **Env vars**, **table names**, **package names** (`@openhawkins/*`) — technical.
- **Spec documents** — technical contracts; the branding overlay lives in
  narrative docs and UI copy, not in the specifications it would muddy.
