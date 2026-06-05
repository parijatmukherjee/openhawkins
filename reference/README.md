# reference/ — seed material (do not run)

This directory holds a **hard copy** of the `openclaw-hawkins` source as it
existed on 2026-06-05, copied in so that **OpenHawkins is fully self-contained**
and has **no dependency on, or reference to, the original repo on disk**.

## Rules

- **Hard separation.** Nothing in OpenHawkins (`packages/`, etc.) may import from
  this directory at runtime. It is *seed material to port from*, not live code.
- **Read-only intent.** Treat these files as a reference snapshot. We port logic
  *out* of here into the new architecture; we don't develop *in* here.
- **Provenance.** Original project: `openclaw-hawkins` (MIT), by Parijat Mukherjee.

## What gets ported where (target → source)

| OpenHawkins target | Ported from |
| --- | --- |
| `@openhawkins/state` (VINES) | `reference/openclaw-hawkins/src/{persistence,recovery,orchestrator}.ts`, `vines/` |
| `@openhawkins/memory` (VECNA) | `reference/openclaw-hawkins/src/hive/`, `vecna/` |
| `@openhawkins/orchestrator` (the Nexus) | `reference/openclaw-hawkins/orchestrator/`, `src/orchestrator.ts`, `src/dispatcher.ts` |
| `@openhawkins/tendrils` | `reference/openclaw-hawkins/agents/`, `skills/` |
| `@openhawkins/tickets` (The Board, replaces Linear) | `reference/openclaw-hawkins/src/linear-client.ts`, `tools/linear-ticket` (concepts only) |

During each subproject (S1+), the relevant logic is rewritten to fit the new
runtime-owned, SQLite-default, in-process architecture — not copied verbatim.
Once a subsystem is ported and superseded, its seed copy here may be deleted.
