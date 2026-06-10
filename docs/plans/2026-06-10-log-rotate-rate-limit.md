# Log Rotation + Rate Limiter Implementation Plan

> **For agentic workers:** Use TDD. One conventional commit per task.

**Goal:** Add structured log rotation to `JsonLogger` and a `RateLimiter` wired into `AgentLoop`.

**Architecture:**

- Task 1: Extend `JsonLoggerOptions` with `path`, `maxSizeBytes`, `maxFiles`. When `path` is set, use a file-based sink that rotates on size. Default to existing sink behavior (no rotation).
- Task 2: Create a `tokenBucket` rate limiter in `packages/core/src/util/rate-limiter.ts`. Add optional `rateLimit` config to `AgentLoopConfig`. Before each model call, check the limiter; if denied, pause (sleep) and log a warning, then retry.

**Tech Stack:** TypeScript, Vitest, Node `node:fs`, ESM.

---

## Task 1: JsonLogger Rotation

**Files:**

- Modify: `packages/core/src/observability/logger.ts`
- Test: `packages/core/test/observability/logger.test.ts`

### Step 1: Write failing test — rotate when size exceeded

```typescript
it("rotates log file when maxSizeBytes is exceeded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "log-rotate-"));
  const path = join(dir, "app.log");
  const log = new JsonLogger({ path, maxSizeBytes: 50 });
  log.log("info", "first");
  log.log("info", "second");
  // first write may not exceed 50, second should trigger rotation
  const files = readdirSync(dir).sort();
  expect(files.length).toBeGreaterThanOrEqual(1);
});
```

Run: `npx vitest run packages/core/test/observability/logger.test.ts`
Expected: FAIL — `path`, `maxSizeBytes` not supported

### Step 2: Minimal implementation

Add `path`, `maxSizeBytes`, `maxFiles` to `JsonLoggerOptions`. In constructor, if `path` is set, create a file-writing sink that tracks current file size and rotates when exceeded.

### Step 3: Green, refactor, commit

---

## Task 2: RateLimiter + AgentLoop wiring

**Files:**

- Create: `packages/core/src/util/rate-limiter.ts`
- Test: `packages/core/test/util/rate-limiter.test.ts`
- Modify: `packages/core/src/loop/agent-loop.ts`
- Test: `packages/core/test/loop/agent-loop.test.ts`

### Step 1: Write failing test for token bucket

```typescript
it("allows requests within capacity and denies excess", () => {
  const limiter = tokenBucket("key1", { capacity: 2, refillRate: 1 });
  expect(limiter.allow()).toBe(true);
  expect(limiter.allow()).toBe(true);
  expect(limiter.allow()).toBe(false);
});
```

Run, verify red, implement minimal `tokenBucket`, verify green.

### Step 2: Write failing test for AgentLoop backpressure

Add optional `rateLimit?: { capacity: number; refillRate: number }` to `AgentLoopConfig`. In `runAgentTurn`, before `adapter.generate`, check rate limiter; if denied, sleep and log warning.

Test:

```typescript
it("pauses and logs warning when model call rate is exceeded", async () => {
  // adapter with 2 responses, rate limit capacity 1
  // first call allowed, second should trigger pause
});
```

Run red, implement minimal wiring, run green.

### Step 3: Green, refactor, commit

---

## Gate

```bash
npm run build && npm run coverage
```
