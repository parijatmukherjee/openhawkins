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
