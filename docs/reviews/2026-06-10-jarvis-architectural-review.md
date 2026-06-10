# Jarvis Vision — Architectural Review Report

**Branch:** `track-zero-flaw-p0`  
**Date:** 2026-06-10  
**Reviewer:** OpenCode (architectural review agent)  
**Vision reference:** [`docs/vision.md`](../vision.md)

---

## Summary

**FAIL** — 15 findings (5 Critical, 6 High, 4 Medium)

The OpenHawkins codebase has a **strong S1 foundation** (capability-gated tool registry, event-sourced sessions, durable SQLite state, keyed audit chain, grounding engine, vault) but **the "Jarvis" layer is entirely conceptual**. There is no orchestrator hub, no voice pipeline, no visual/monitor control, no skills system, no agent pool, no scheduler, and no desktop interface. The vision document declares a physical AI hub; the codebase is a single-agent CLI runtime.

---

## Gap Analysis

### 🔴 Critical Gaps (missing foundational pieces)

#### C1: `@openhawkins/jarvis` — The hub orchestrator is entirely missing

The vision declares "Jarvis is the single interface" and "Jarvis delegates." The codebase has **no orchestrator package**. The `AgentRun` + `PlaybookRun` in `core` are a **single-agent process engine** (one agent runs through phases), not a multi-agent orchestrator. There is no intent parsing, no delegation protocol, no agent pool, no synthesis layer. The `Agent` class is an evaluator for one turn of one agent — it cannot coordinate a team.

#### C2: `@openhawkins/agents` — Specialist agent definitions missing

The vision lists 7 specialist agents (Research, System, Code, Vision, Comm, Memory, Creative). The codebase has **zero agent definitions**. The word "tendril" appears only as a **string tag in the VECNA memory schema** — a placeholder, not a runtime entity. There is no agent factory, no role definitions, no scoped tool surfaces per specialty.

#### C3: `@openhawkins/skills` — Skill marketplace, installer, sandbox missing

The vision says "Jarvis can download, install, and learn skills on demand" with `SKILL.md` manifests and capability-gated sandboxes. The codebase has **no skill manifest parser, no installer, no marketplace client, no sandbox loader**. The `CapabilityName` type is a **closed hardcoded enum** — skills cannot declare new capabilities dynamically.

#### C4: Voice pipeline — Wake word, STT, TTS entirely absent

The vision says "voice-first, visual-second" with local wake-word detection, local STT, and local TTS. A grep across the entire `packages/` directory returned **zero matches** for `voice`, `stt`, `tts`, `speech`, `audio`, `microphone`, `speaker`, `wake`, or `whisper`.

#### C5: `@openhawkins/desktop` — Electron dashboard / monitor controller missing

The vision says Jarvis "opens the right apps on your monitors." The codebase has **zero display/monitor/window/app-control code**. No matches for `electron`, `monitor`, `display`, `desktop`, `window`, `screen`, or `launch`.

---

### 🟡 High Gaps (needed for v1)

#### H1: Security code embedded in `core`, not standalone package

The vision lists `@openhawkins/security` as a separate package. All security code lives inside `@openhawkins/core` (`src/security/`). Not a functional failure, but a package architecture violation.

#### H2: `@openhawkins/channels` — exists in plans but not in code

No `packages/channels/` directory, no gateway daemon, no WebSocket server, no chat bridge. The only "channel" is `stdin`/`stdout` in the `ask` and `run` CLIs.

#### H3: Proactive / scheduled behavior — no scheduler, no event bus

The vision says Jarvis is "proactive." The codebase has **no scheduler, no cron, no timer, no pub/sub, no cross-agent communication**. The `EventStore` is per-session append-only log — not a system-wide event bus.

#### H4: Agent capability revocation — grants are static

The `AgentGrant` interface is a static capability list passed at construction time. There is **no runtime API to mutate, revoke, or time-limit a grant**.

#### H5: Agent-level isolation — only in-process, no sandbox

The current sandbox is **in-process only**: the `ToolRegistry` performs capability checks, but there is **no process isolation, no containerization, no OS-level confinement**. A compromised agent with `shell` capability can execute arbitrary host commands.

#### H6: Skills registry in state schema — table missing

The `SCHEMA` in `packages/state/src/schema.ts` only defines `events` and `audit` tables. There is **no `skills` table, no `agents` table, no `sessions` table for multi-agent tracking**.

---

### 🟢 Medium Gaps (nice to have)

#### M1: `@openhawkins/sync` — skeleton exists but is ghost package

The `packages/sync/` directory contains only compiled artifacts (no source, no `package.json`). Either properly initialize or remove.

#### M2: Memory not wired into agent path by default

`Agent.ask()` has an **optional** `memory?: MemoryStore` injection point, but `buildAgentRun` and the CLI do not wire VECNA. For a Jarvis hub that "remembers everything," memory must be default-on, not opt-in.

#### M3: No Jarvis persona / system prompt layer

The vision says "Jarvis is the leader" with a personality. The codebase has **no Jarvis persona abstraction**. The `Agent` class takes a generic `systemPrompt: string`; there is no Jarvis-specific prompt template.

#### M4: No multi-monitor abstraction in core

There is no `Display`, `Monitor`, or `WindowManager` type in `core`. The OS layer only has `platform.ts` (detects OS and returns `configDir`/`dataDir`).

---

## Package Structure Recommendation

```
packages/
├── core/          ✅ exists — agent loop, grounding, tools, capabilities
                  ⚠️  only supports SINGLE agent, not orchestration
├── jarvis/        🔴 MISSING — wake word, STT, TTS, orchestrator, intent parser
├── agents/        🔴 MISSING — specialist agent definitions + factory
├── skills/        🔴 MISSING — SKILL.md loader, installer, marketplace
├── state/         ✅ exists — SQLite events, audit
                  ⚠️  missing skills registry table, agent roster table
├── memory/        ✅ exists — VECNA fragments
                  ⚠️  not wired into agent path by default
├── markdownify/   ✅ exists — document converters
                  ⚠️  not wired into agent path by default
├── sync/          🟡 ghost — dist-only, no source
├── desktop/       🔴 MISSING — Electron dashboard, monitor controller
├── security/      🔴 MISSING as standalone — embedded in core
├── channels/      🔴 MISSING — Telegram/Discord/WS gateways
├── plugin-sdk/    🔴 MISSING — public extension contract
└── registry/      🔴 MISSING — plugin loader + resolver
```

---

## Implementation Roadmap

| Phase | What | Priority | Est. Effort |
|-------|------|----------|-------------|
| **J1** | **Design `@openhawkins/jarvis` architecture** — intent parser, delegation protocol, agent pool interface, synthesis engine, voice pipeline interfaces | P0 | 1–2 weeks |
| **J2** | **Stand up `@openhawkins/agents`** — agent factory, 7 specialist roles, scoped grants | P0 | 2 weeks |
| **J3** | **Voice pipeline interfaces** — `AudioInput`, `AudioOutput`, `WakeWordEngine`, `SttEngine`, `TtsEngine` | P0 | 1 week |
| **J4** | **Skills system v0** — `SKILL.md` parser, installer, capability-gated loader | P0 | 2–3 weeks |
| **J5** | **Monitor controller v0** — `DisplayManager`, OS app launchers, multi-monitor | P0 | 1–2 weeks |
| **J6** | **Wire memory + markdownify** — make VECNA default-injected | P1 | 3–5 days |
| **J7** | **Proactive scheduler** — job registry, event bus, time-based initiation | P1 | 2 weeks |
| **J8** | **Electron dashboard skeleton** | P1 | 2 weeks |
| **J9** | **Security package extraction** | P2 | 1 week |
| **J10** | **Agent-level isolation** | P2 | 3–4 weeks |
| **J11** | **Channels gateway** | P2 | 2–3 weeks |
| **J12** | **Skill marketplace client** | P3 | 2–3 weeks |

---

## Recommendations

1. **J1 is the bottleneck — everything else depends on it.** The orchestrator interface (`JarvisHub`) determines how agents are spawned, how skills are loaded, how voice input routes to intent, and how results synthesize back to TTS/monitor. Spec this first.

2. **Keep the capability model — extend it, don't rewrite it.** The `CapabilityName` closed enum must become an **open registry** that skills can extend. Build `SkillLoader` on top of `ToolRegistry` + `Capability` — do not invent a new permission system.

3. **Voice pipeline: start with interfaces, integrate real models later.** Start with `SttAdapter`/`TtsAdapter` interfaces and a `MockVoiceEngine`. Integrate Whisper/Ollama in J1.1.

4. **Monitor controller: leverage existing OS abstractions.** Use platform-specific commands (`open`, `xdg-open`, PowerShell) wrapped in a typed `DisplayManager` interface.

5. **Update CHECKPOINT.md.** The production-readiness foundation is finished. Update to reflect that **S3 (Nexus) is unblocked** and the next canonical work is J1.

---

*Review conducted on 2026-06-10. All 245 source files examined.*
