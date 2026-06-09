# OpenHawkins — agent working guide

> Your own AI-agent platform: a self-owned runtime with the Hawkins multi-agent
> orchestration pattern. TypeScript monorepo, embedded SQLite, single self-contained
> binary. Thesis: **the model proposes, the runtime enforces** (grounding,
> tool-calling, state, capabilities).

## Operating procedure (follow for all substantive work)

Run every feature, refactor, or design change through this loop:

1. **Research** — read the code/docs; ground assumptions with quick spikes _before_
   committing to a design.
2. **Plan** — write a design spec when the design is non-trivial, then a
   task-by-task implementation plan.
3. **Tasks** — decompose the plan into bite-sized, independently-reviewable tasks.
4. **Execute** — implement task-by-task, TDD (failing test first).
5. **Validate & Test** — per task: spec-compliance review + code-quality review; then
   the gate: `build · lint · format:check · coverage (≥99%) · test · test:functional`
   and the Docker gate. **If anything fails, go back to Plan.**
6. **Present** — open a PR; summarize; the human decides merge.

**Scale to the task.** A trivial question gets a direct answer — don't force a plan
onto a one-line lookup. The loop is for work that changes the system.

This process will become **runtime-enforced in the product itself** — see
[ADR 0002](docs/adr/0002-process-enforcement-native-not-n8n.md) and the
[Playbook design stub](docs/specs/2026-06-09-playbook-process-engine-design.md).
Until it ships it is documented practice; the Validate/Test phase is already
hard-enforced by CI.

## Hard rules (the gate)

- `main` is protected: land via a PR whose **required `docker-gate`** passes
  (build + lint + format:check + **coverage ≥99%** + unit + functional; see `vitest.config.ts`).
  Do not lower it. Earn coverage with real tests, not by gaming.
- Conventional commits; one logical change per commit. Spikes are throwaway — don't
  commit them.

## Layout

- `packages/core` — runtime: agent loop, model adapters, typed tool registry,
  **Eleven** grounding engine, capability sandbox (**The Lab**), **Murray** audit.
- `packages/state` — **VINES**: durable SQLite (`SqlDriver` + migrations +
  event store). One driver port over `node:sqlite` (dev/test) / `bun:sqlite` (binary).
- `packages/memory` — **VECNA**: decay-aware memory (fragments, recall, pure-JS
  vector embeddings + FTS5 lexical fallback).
- `docs/specs` · `docs/plans` · `docs/adr` — design specs, implementation plans, ADRs.

## Conventions

- TypeScript strict (`exactOptionalPropertyTypes`, `verbatimModuleSyntax`); ESM with
  `.js` import specifiers; Prettier (printWidth 100, double quotes).
- Cross-package code must build + run on both Node and Bun (the CI matrix runs both);
  no native addons in the single-binary path.
