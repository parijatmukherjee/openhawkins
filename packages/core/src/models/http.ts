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
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type HttpFetch = (url: string, init: HttpRequestInit) => Promise<HttpResponse>;

/** The real transport: a thin pass-through to the platform `fetch` (Node 20+/Bun). */
export const defaultHttp: HttpFetch = (url, init) => fetch(url, init);

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
