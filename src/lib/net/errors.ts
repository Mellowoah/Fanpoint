/**
 * One error type for every upstream provider (Qloo, the LLM). `code` drives retry decisions server-side and the
 * error state the UI shows; `userMessage` is safe to show to a user (it never contains keys or raw bodies).
 */
export type Provider = "qloo" | "llm";
export type ErrorCode =
  | "timeout" // no response within the per-attempt timeout (after all retries)
  | "rate_limited" // HTTP 429 after all retries
  | "auth" // HTTP 401 (and 403 for the LLM): bad or missing key
  | "forbidden" // Qloo HTTP 403: the key is fine but this entity type/endpoint is not enabled for it
  | "not_found" // HTTP 404
  | "bad_request" // other 4xx: our request was wrong; retrying will not help
  | "upstream" // 5xx after all retries
  | "network" // DNS/connection failure after all retries
  | "invalid_response" // 2xx but the body is not the documented shape
  | "budget" // Routed's own per-run call cap was reached (protects the monthly quota)
  | "config"; // Routed is misconfigured (e.g. an untrusted base URL); no request was sent

const RETRYABLE: ReadonlySet<ErrorCode> = new Set(["timeout", "rate_limited", "upstream", "network"]);
/** Codes after which continuing the run is pointless (every later call would fail the same way). */
const FATAL: ReadonlySet<ErrorCode> = new Set(["auth", "rate_limited", "budget", "config"]);

const NAMES: Record<Provider, string> = { qloo: "Qloo", llm: "The language model" };

export class ProviderError extends Error {
  override readonly name = "ProviderError";
  constructor(
    readonly provider: Provider,
    readonly code: ErrorCode,
    /** Developer detail (status, endpoint, truncated body). Logged server-side, not shown in the UI. */
    readonly detail: string,
    readonly status?: number,
    readonly attempts = 1,
  ) {
    super(`${provider} ${code}${status ? ` (HTTP ${status})` : ""}: ${detail}`);
  }
  get retryable(): boolean { return RETRYABLE.has(this.code); }
  get fatal(): boolean { return FATAL.has(this.code); }
  get userMessage(): string { return userMessage(this.provider, this.code, this.status, this.attempts); }
}

export function userMessage(provider: Provider, code: ErrorCode, status?: number, attempts = 1): string {
  const who = NAMES[provider];
  const tries = attempts > 1 ? ` after ${attempts} attempts` : "";
  switch (code) {
    case "timeout": return `${who} did not respond in time${tries}. Try again in a moment.`;
    case "rate_limited": return `${who} is rate-limiting requests (HTTP 429)${tries}. Wait a minute and try again.`;
    case "auth": return provider === "qloo"
      ? `Qloo rejected the API key (HTTP ${status ?? 401}). Check QLOO_API_KEY; hackathon keys only work on https://hackathon.api.qloo.com, not api.qloo.com.`
      : `The language model rejected the API key (HTTP ${status ?? "401/403"}). Check LLM_API_KEY and LLM_BASE_URL.`;
    case "forbidden": return provider === "qloo"
      ? `Qloo refused this request type (HTTP ${status ?? 403}); hackathon keys answer 403 for entity types that are not enabled. That part of the plan was skipped.`
      : `The language model refused the request (HTTP ${status ?? 403}).`;
    case "not_found": return `${who} returned "not found" (HTTP 404).`;
    case "bad_request": return `${who} rejected the request (HTTP ${status ?? "4xx"}). This is a bug in Routed's request; please report it.`;
    case "upstream": return `${who} had a server error (HTTP ${status ?? "5xx"})${tries}. Try again shortly.`;
    case "network": return `Could not reach ${who}${tries}. Check the network or base URL.`;
    case "invalid_response": return `${who} returned data in an unexpected format, so it was not used.`;
    case "budget": return `This run hit Routed's safety cap on ${who} calls (protects the monthly quota). Try fewer anchors or peers.`;
    case "config": return provider === "qloo"
      ? "Routed's Qloo settings are invalid (QLOO_BASE_URL must be an https Qloo host, or exactly match QLOO_TRUSTED_BASE_URL). No request was sent."
      : "Routed's language-model settings are invalid (LLM_BASE_URL must be an https Gemini or OpenAI host, or exactly match LLM_TRUSTED_BASE_URL). No request was sent.";
  }
}

export const isProviderError = (e: unknown): e is ProviderError => e instanceof ProviderError;
