/**
 * A deliberately tiny HTTP seam. The provider adapters depend on this narrow
 * `HttpFetch` type rather than the global `fetch` so tests can inject a stub that
 * returns exactly the JSON a real Ollama / OpenAI server would — no network, fully
 * deterministic — while production uses the real `fetch` (`defaultHttp`).
 */

export interface HttpRequestInit {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type HttpFetch = (url: string, init: HttpRequestInit) => Promise<HttpResponse>;

/** The real transport: a thin pass-through to the platform `fetch` (Node 20+/Bun). */
export const defaultHttp: HttpFetch = (url, init) =>
  fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    ...(init.signal ? { signal: init.signal } : {}),
  });

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
    const res = await http(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    if (controller.signal.aborted) {
      throw new Error(`request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
}

/** Run `fn`, retrying a throw up to `retries` times with exponential backoff. Transient
 *  provider/network failures are the common case at scale (review F-H1). */
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
