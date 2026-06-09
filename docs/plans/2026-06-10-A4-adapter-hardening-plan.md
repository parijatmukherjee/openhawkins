# Track A4 — Harden the Model/IO Boundary — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the model-call boundary survive real-world provider behavior — the highest-frequency failure path, currently with zero protection. Fixes **F-C4** (a `200` with a non-JSON body throws an uncaught `SyntaxError` that kills the turn), **F-H1** (no timeout/retry/cancellation — a hung provider wedges the turn and head-of-line-blocks the session), and **F-M4** (no `https`/scheme validation — an `http://` non-loopback base sends the bearer key in cleartext).

**Architecture:** Three shared helpers in the model layer, used by BOTH adapters (`OllamaAdapter`, `OpenAiCompatAdapter`):

1. `parseJsonOrThrow<T>(text, provider, status)` — guarded `JSON.parse` → a typed "non-JSON from provider" error instead of a raw `SyntaxError`.
2. `requestWithTimeout(http, url, init, timeoutMs)` + `withRetry(fn, opts)` — an `AbortController` deadline and bounded retry-with-backoff around the request; `HttpRequestInit` gains an optional `signal` that `defaultHttp` forwards to `fetch`.
3. `assertSafeBaseUrl(url)` — require `https` for any non-loopback host (loopback `http` is fine for local Ollama).

**Tech Stack:** TypeScript strict, ESM `.js` specifiers, Vitest, Node 24 + Bun 1.3. Prettier printWidth 100, double quotes.

**Review basis:** [`docs/reviews/2026-06-09-production-readiness-review.md`](../reviews/2026-06-09-production-readiness-review.md) — **A4 / F-C4 / F-H1 / F-M4**.

**Depends on (merged):** `packages/core/src/models/http.ts` (`HttpFetch`, `HttpRequestInit`, `HttpResponse`, `defaultHttp`); `models/ollama.ts`, `models/openai-compat.ts` (both: `JSON.parse(text)` unguarded on the success path; `baseUrl` only trailing-slash-trimmed; no timeout/retry). The existing adapter tests inject a stub `HttpFetch`.

**Conventions:** Coverage ≥99%; new/changed src files 100%. Retry backoff must be test-fast (injectable/zero delay in tests). Timeout tests use a stub that honors the `AbortSignal`. NEVER hit a real network in tests.

---

### Task 1: Guarded JSON parse (F-C4) + `https` validation (F-M4)

**Files:**

- Modify: `packages/core/src/models/http.ts` (add `parseJsonOrThrow` + `assertSafeBaseUrl`)
- Modify: `packages/core/src/models/ollama.ts` + `models/openai-compat.ts` (use them)
- Test: `packages/core/test/models/http.test.ts` (new — the helpers) + extend the adapter tests

- [ ] **Step 1: Write the failing tests** — `packages/core/test/models/http.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseJsonOrThrow, assertSafeBaseUrl } from "../../src/models/http.js";

describe("parseJsonOrThrow", () => {
  it("parses valid JSON", () => {
    expect(parseJsonOrThrow<{ a: number }>('{"a":1}', "ollama", 200)).toEqual({ a: 1 });
  });
  it("throws a typed, diagnosable error for a non-JSON body (not a raw SyntaxError)", () => {
    expect(() => parseJsonOrThrow("<html>503</html>", "openai", 200)).toThrow(
      /openai returned non-JSON \(200\)/,
    );
  });
});

describe("assertSafeBaseUrl", () => {
  it("allows https anywhere and http on loopback", () => {
    expect(() => assertSafeBaseUrl("https://api.openai.com/v1")).not.toThrow();
    expect(() => assertSafeBaseUrl("http://127.0.0.1:11434")).not.toThrow();
    expect(() => assertSafeBaseUrl("http://localhost:11434")).not.toThrow();
    expect(() => assertSafeBaseUrl("http://[::1]:11434")).not.toThrow();
  });
  it("rejects http to a non-loopback host (would leak the bearer key in cleartext)", () => {
    expect(() => assertSafeBaseUrl("http://api.example.com/v1")).toThrow(/requires https/);
  });
  it("throws on an unparseable URL", () => {
    expect(() => assertSafeBaseUrl("not a url")).toThrow();
  });
});
```

Also extend the adapter tests (`packages/core/test/models/openai-compat.test.ts`, and the ollama test if present) with: a `200` whose `text()` is non-JSON → `generate` rejects with a `/non-JSON/` error (not a raw `Unexpected token`).

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Add to `packages/core/src/models/http.ts`:**

```ts
/** Parse a provider response body, turning a non-JSON body (an HTML 5xx page, a gateway
 *  interstitial, a captive portal) into a diagnosable error instead of a raw SyntaxError
 *  that kills the turn opaquely (review F-C4). */
export function parseJsonOrThrow<T>(text: string, provider: string, status: number): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.slice(0, 200);
    throw new Error(`${provider} returned non-JSON (${status}): ${preview}`);
  }
}

/** Require https for any non-loopback host — an http base to a remote host sends the
 *  bearer key in cleartext (review F-M4). Loopback http (local Ollama) is allowed. */
export function assertSafeBaseUrl(url: string): void {
  const u = new URL(url); // throws on an unparseable URL
  const host = u.hostname.replace(/^\[|\]$/g, ""); // strip [] from IPv6
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (u.protocol !== "https:" && !loopback) {
    throw new Error(`baseUrl "${url}" requires https for a non-loopback host`);
  }
}
```

- [ ] **Step 3b: Use them in the adapters.**
  - `ollama.ts`: in the constructor, after computing `this.baseUrl`, call `assertSafeBaseUrl(this.baseUrl)`. In `generate`, replace `JSON.parse(text) as OllamaChatResponse` with `parseJsonOrThrow<OllamaChatResponse>(text, "ollama", res.status)`.
  - `openai-compat.ts`: same — `assertSafeBaseUrl(this.baseUrl)` in the constructor; `parseJsonOrThrow<OpenAiChatResponse>(text, "openai-compat", res.status)` in `generate`.
  - Import both helpers from `./http.js`.

- [ ] **Step 4: Run → pass + 100% coverage** of `http.ts` and the two adapters:
      `npx vitest run packages/core/test/models --coverage.enabled --coverage.include='packages/core/src/models/http.ts' --coverage.include='packages/core/src/models/ollama.ts' --coverage.include='packages/core/src/models/openai-compat.ts'` — all PASS, 100%. (Existing adapter tests use loopback/https bases, so `assertSafeBaseUrl` won't throw for them; if any existing test uses an `http://` non-loopback base, switch it to `https://` or loopback.)

- [ ] **Step 5: Gates + `npm run build`.** Clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/models/http.ts packages/core/src/models/ollama.ts packages/core/src/models/openai-compat.ts packages/core/test/models/http.test.ts packages/core/test/models/openai-compat.test.ts
git commit -m "feat(models): guarded JSON parse (F-C4) + https-for-non-loopback baseUrl (F-M4)"
```

---

### Task 2: Timeout + bounded retry (F-H1)

**Files:**

- Modify: `packages/core/src/models/http.ts` (add `signal` to `HttpRequestInit`; `requestWithTimeout` + `withRetry`)
- Modify: `models/ollama.ts` + `models/openai-compat.ts` (wrap the request; add `timeoutMs`/`retries` config)
- Test: `packages/core/test/models/http.test.ts` (extend)

- [ ] **Step 1: Write the failing tests** (append to `http.test.ts`):

```ts
import { requestWithTimeout, withRetry, type HttpFetch } from "../../src/models/http.js";

const okResponse = (text = "{}") => ({ ok: true, status: 200, text: async () => text });

describe("requestWithTimeout", () => {
  it("returns the response when the call resolves in time", async () => {
    const http: HttpFetch = async () => okResponse();
    const res = await requestWithTimeout(
      http,
      "https://x",
      { method: "POST", headers: {}, body: "" },
      50,
    );
    expect(res.ok).toBe(true);
  });
  it("aborts and throws a timeout error when the call exceeds the deadline", async () => {
    // a stub that only settles when its signal aborts
    const hang: HttpFetch = (_u, init) =>
      new Promise((_res, rej) =>
        init.signal?.addEventListener("abort", () => rej(new Error("aborted"))),
      );
    await expect(
      requestWithTimeout(hang, "https://x", { method: "POST", headers: {}, body: "" }, 10),
    ).rejects.toThrow(/timed out/);
  });
});

describe("withRetry", () => {
  it("retries a transient failure then succeeds", async () => {
    let n = 0;
    const r = await withRetry(
      async () => {
        if (n++ < 2) throw new Error("ECONNRESET");
        return "ok";
      },
      { retries: 3, baseDelayMs: 0 },
    );
    expect(r).toBe("ok");
    expect(n).toBe(3);
  });
  it("gives up after exhausting retries, surfacing the last error", async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new Error("down");
        },
        { retries: 2, baseDelayMs: 0 },
      ),
    ).rejects.toThrow(/down/);
    expect(n).toBe(3); // initial + 2 retries
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Edit `packages/core/src/models/http.ts`:**

Add `signal` to the init type and forward it in `defaultHttp`:

```ts
export interface HttpRequestInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export const defaultHttp: HttpFetch = (url, init) =>
  fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    ...(init.signal ? { signal: init.signal } : {}),
  });
```

Add the helpers:

```ts
/** Run an HTTP request under a deadline: aborts via `AbortController` after `timeoutMs`
 *  and throws a clear timeout error rather than hanging the turn (review F-H1). */
export async function requestWithTimeout(
  http: HttpFetch,
  url: string,
  init: HttpRequestInit,
  timeoutMs: number,
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await http(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
}

/** Run `fn`, retrying a throw up to `retries` times with exponential backoff + jitter.
 *  Transient provider/network failures are the common case at scale (review F-H1). */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < opts.retries) {
        const backoff = opts.baseDelayMs * 2 ** attempt;
        await new Promise((r) => setTimeout(r, backoff));
      }
    }
  }
  throw lastErr;
}
```

> Note: jitter via `Math.random()` is omitted to keep this deterministic and because `Math.random` is unavailable in some sandboxes; exponential backoff (with `baseDelayMs: 0` in tests) is sufficient. If real jitter is wanted later, add it behind an injectable RNG.

- [ ] **Step 3b: Wire into the adapters.** Add `timeoutMs?: number` and `retries?: number` to each adapter's config (default `timeoutMs: 30000`, `retries: 2`). In `generate`, replace the bare `await this.http(url, {...})` with:

```ts
const res = await withRetry(
  () =>
    requestWithTimeout(
      this.http,
      url,
      { method: "POST", headers, body: JSON.stringify(body) },
      this.timeoutMs,
    ),
  { retries: this.retries, baseDelayMs: this.retryBaseMs },
);
```

(Hold `this.timeoutMs`/`this.retries`/`this.retryBaseMs` from config with the defaults above; `retryBaseMs` default e.g. `200`.) Everything after (the `!res.ok` check, `parseJsonOrThrow`) is unchanged.

- [ ] **Step 4: Run → pass + 100% coverage** of `http.ts` and the adapters. The adapter tests' stub resolves immediately (no timeout, no retry needed), so they still pass; the timeout/retry branches are covered by the `http.test.ts` unit tests. Confirm 100%; if the adapters' new `timeoutMs ?? 30000` defaults leave an uncovered branch, add a tiny adapter test passing an explicit `timeoutMs`/`retries`.

- [ ] **Step 5: Gates + `npm run build`.** Clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/core/src/models/http.ts packages/core/src/models/ollama.ts packages/core/src/models/openai-compat.ts packages/core/test/models/http.test.ts
git commit -m "feat(models): request timeout + bounded retry/backoff (F-H1)"
```

---

### Task 3: Roadmap + the full gate

- [ ] **Step 1: Roadmap.** In `docs/reviews/2026-06-09-production-readiness-review.md` §3, mark **A4** done: `4. **A4 — Harden the model/IO boundary (F-C4/F-H1/F-M4) ✅ DONE (PR pending).**` keep the rest. (Note: `runCommand` timeout from F-H1 — the gate-command spawn — is deferred to A4b if not done here; the model-call path, the higher-frequency one, is hardened.)
- [ ] **Step 2: Full repo gate.** `npm run build && npm run lint && npm run format:check && npm run coverage && npm run test:functional` — all green; aggregate ≥99%; `http.ts` + both adapters 100%. Paste the coverage tail.
- [ ] **Step 3: Docker gate.** `docker build -f Dockerfile.test -t openhawkins-test . && docker run --rm openhawkins-test` → `✅ ALL GATES PASSED`.
- [ ] **Step 4: Commit.**

```bash
git add docs/reviews/2026-06-09-production-readiness-review.md
git commit -m "docs(review): A4 model/IO boundary hardened (F-C4/F-H1/F-M4)"
```

---

## Self-Review (coverage of the A4 scope)

- **F-C4 — guarded JSON parse:** `parseJsonOrThrow` in both adapters (Task 1) — a non-JSON 200 yields a typed error, not a turn-killing `SyntaxError`. ✓
- **F-M4 — https validation:** `assertSafeBaseUrl` in both constructors (Task 1) — http to a non-loopback host is rejected. ✓
- **F-H1 — timeout + retry:** `requestWithTimeout` + `withRetry` wrapping `generate` (Task 2) — a hung provider aborts on a deadline; transient failures retry with backoff. ✓
- **Deferred:** `runCommand` (gate spawn) timeout/kill → A4b (lower frequency than model calls). Real jitter behind an injectable RNG → future.
- **Type consistency:** `parseJsonOrThrow`, `assertSafeBaseUrl`, `requestWithTimeout`, `withRetry`, `RetryOptions`, `HttpRequestInit.signal` — used identically across tasks. ✓

## Next (Track A continues)

A5 (dual-`replans`, F-H2) — a quick correctness fix. Then A6 (vault), A7 (observability), A8 (input caps + citation), plus A4b/A2b/A2c and Track B.
