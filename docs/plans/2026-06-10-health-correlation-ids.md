# Health Probe + Correlation IDs Implementation Plan

> **Goal:** Add `--health` CLI flag to `openhawkins-run` and add `traceId` correlation to all log entries per turn.

**Architecture:** Health check is a standalone module in `@openhawkins/state` that probes DB, Vault, audit, and error rate; correlation IDs flow through `Logger.log` → `AgentLoopConfig` → `TurnRecord` → audit data.

**Tech Stack:** TypeScript strict, ESM, vitest, Node `crypto.randomUUID`.

---

## Task 1: Health/readiness probe

### Task 1.1: `checkHealth` logic + tests (TDD)

**Files:**

- Create: `packages/state/src/health.ts`
- Create: `packages/state/test/health.test.ts`

- [ ] **Step 1: Write failing test for checkHealth**
- [ ] **Step 2: Implement checkHealth**
- [ ] **Step 3: Verify tests pass**

### Task 1.2: Wire `--health` into `openhawkins-run` CLI

**Files:**

- Modify: `packages/state/src/bin/openhawkins-run.ts`

- [ ] **Step 4: Add `--health` flag handling**
- [ ] **Step 5: Export `checkHealth` from `packages/state/src/index.ts`**
- [ ] **Step 6: Verify build + coverage**

## Task 2: Correlation IDs (`traceId`)

### Task 2.1: Add `traceId` to `Logger`

**Files:**

- Modify: `packages/core/src/observability/logger.ts`
- Modify: `packages/core/test/observability/logger.test.ts`

- [ ] **Step 7: Write failing test for traceId in JsonLogger**
- [ ] **Step 8: Add traceId param to Logger interface and JsonLogger**

### Task 2.2: Propagate `traceId` through agent loop

**Files:**

- Modify: `packages/core/src/eval/agent.ts`
- Modify: `packages/core/src/loop/agent-loop.ts`
- Modify: `packages/core/src/loop/turn.ts`
- Modify: `packages/core/test/eval/agent.test.ts`
- Modify: `packages/core/test/loop/agent-loop.test.ts`

- [ ] **Step 9: Write failing test for traceId in TurnRecord**
- [ ] **Step 10: Add traceId to AgentLoopConfig, generate per turn in Agent.ask**
- [ ] **Step 11: Thread traceId through audit entries**
- [ ] **Step 12: Verify all core tests pass**

### Task 2.3: Gate validation

- [ ] **Step 13: `npm run build && npm run coverage`**
- [ ] **Step 14: Commit each task separately**
