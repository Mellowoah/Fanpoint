/**
 * fetch with a per-attempt timeout, retries with exponential backoff + jitter on 429/5xx/network/timeouts,
 * `Retry-After` support, and an optional rate limiter. Never retries other 4xx (they will not get better).
 */
import { ProviderError, type ErrorCode, type Provider } from "./errors";
import { realClock, type Clock, type RateLimiter } from "./rate-limiter";

export interface RetryPolicy {
  /** Retries after the first attempt (total attempts = retries + 1). */
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Per-attempt timeout, covering headers and body. */
  timeoutMs: number;
  /** HTTP statuses to retry. Defaults to DEFAULT_RETRY_STATUS. */
  retryOn?: ReadonlySet<number>;
  /** Reject bodies larger than this (bytes) as invalid_response instead of buffering them. Default: no cap. */
  maxBodyBytes?: number;
}
export interface HttpDeps { fetch?: typeof fetch; clock?: Clock; random?: () => number; limiter?: RateLimiter }
export interface HttpResult { status: number; text: string; attempts: number; ms: number }

/** Status codes worth retrying by default: rate limit, and transient server/gateway errors. */
export const DEFAULT_RETRY_STATUS: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Map an HTTP status to an error code. Qloo's hackathon guide documents 401 for a bad/missing key or wrong host,
 * and 403 "You do not have permission to access urn:entity:..." for an entity type the key cannot use, so a Qloo
 * 403 is a per-request problem (degrade), not a dead key (abort). For other providers 403 means auth.
 */
export function codeForStatus(status: number, provider: Provider = "llm"): ErrorCode {
  if (status === 403 && provider === "qloo") return "forbidden";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status === 408) return "timeout";
  if (status >= 500) return "upstream";
  return "bad_request";
}

/** Parse Retry-After (delta-seconds or HTTP-date) into ms, or undefined. */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const s = Number(header);
  if (Number.isFinite(s) && s >= 0) return s * 1000;
  const t = Date.parse(header);
  return Number.isFinite(t) ? Math.max(0, t - now) : undefined;
}

/**
 * Google APIs (Gemini included) put the wait in the 429 body instead of a header:
 * error.details[] { "@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "34s" }.
 */
export function retryDelayFromBody(text: string): number | undefined {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text);
  return m ? Math.round(Number(m[1]) * 1000) : undefined;
}

/** Full-jitter-ish exponential backoff: base * 2^attempt, scaled into [50%, 100%], capped. */
export function backoffMs(attempt: number, p: RetryPolicy, random: () => number): number {
  const exp = Math.min(p.maxDelayMs, p.baseDelayMs * 2 ** attempt);
  return Math.round(exp * (0.5 + random() / 2));
}

export async function requestWithRetry(provider: Provider, url: string, init: RequestInit, policy: RetryPolicy, deps: HttpDeps = {}): Promise<HttpResult> {
  const doFetch = deps.fetch ?? fetch;
  const clock = deps.clock ?? realClock;
  const random = deps.random ?? Math.random;
  const t0 = clock.now();
  let last: ProviderError | undefined;

  for (let attempt = 0; attempt <= policy.retries; attempt++) {
    if (deps.limiter) await deps.limiter.acquire();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), policy.timeoutMs);
    let wait: number | undefined;
    try {
      const res = await doFetch(url, { ...init, signal: ctrl.signal });
      const declared = Number(res.headers.get("content-length"));
      if (policy.maxBodyBytes && Number.isFinite(declared) && declared > policy.maxBodyBytes) {
        await res.body?.cancel().catch(() => undefined);
        throw new ProviderError(provider, "invalid_response", `${redact(url)}: body of ${declared} bytes exceeds ${policy.maxBodyBytes}`, res.status, attempt + 1);
      }
      const text = await res.text();
      if (policy.maxBodyBytes && text.length > policy.maxBodyBytes) {
        throw new ProviderError(provider, "invalid_response", `${redact(url)}: body exceeds ${policy.maxBodyBytes} bytes`, res.status, attempt + 1);
      }
      if (res.ok) return { status: res.status, text, attempts: attempt + 1, ms: clock.now() - t0 };
      last = new ProviderError(provider, codeForStatus(res.status, provider), `${redact(url)} -> ${text.slice(0, 200)}`, res.status, attempt + 1);
      if (!(policy.retryOn ?? DEFAULT_RETRY_STATUS).has(res.status)) throw last;
      wait = retryAfterMs(res.headers.get("retry-after"), clock.now()) ?? retryDelayFromBody(text);
    } catch (e) {
      if (e instanceof ProviderError) throw e;
      const aborted = ctrl.signal.aborted;
      last = new ProviderError(provider, aborted ? "timeout" : "network",
        aborted ? `${redact(url)} timed out after ${policy.timeoutMs} ms` : `${redact(url)}: ${(e as Error).message}`, undefined, attempt + 1);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < policy.retries) await clock.sleep(Math.min(policy.maxDelayMs, wait ?? backoffMs(attempt, policy, random)));
  }
  // Loop always assigns `last` before falling through.
  throw last ?? new ProviderError(provider, "network", "no attempts made");
}

/** Origin + path only: query strings never go into error messages (they can be long, and could carry secrets). */
export function redact(url: string): string {
  try { const u = new URL(url); return `${u.origin}${u.pathname}`; } catch { return "(invalid url)"; }
}
