/**
 * Decide whether an LLM base URL is safe to send LLM_API_KEY to (same policy as qloo/base-url.ts).
 * Known hosts are the two documented OpenAI-compatible endpoints Fanpoint is tested against:
 *   - generativelanguage.googleapis.com: Google's Gemini OpenAI-compatibility endpoint, the default
 *     (https://ai.google.dev/gemini-api/docs/openai, base URL .../v1beta/openai/);
 *   - api.openai.com: OpenAI.
 * Anything else (OpenRouter, Groq, a local vLLM, a proxy) needs the exact URL in LLM_TRUSTED_BASE_URL.
 * This list is for LLM_API_KEY only: the Qloo key keeps its own list (Qloo hosts only), so neither key can be
 * sent to the other provider.
 */
import { checkKeyedBaseUrl, type BaseUrlCheck } from "../qloo/base-url";

export const GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";
/** Default model: stable, free of charge on the Gemini free tier, supports function calling (see docs/ENV.md). */
export const GEMINI_DEFAULT_MODEL = "gemini-3.5-flash-lite";
export const KNOWN_LLM_HOSTS: ReadonlySet<string> = new Set(["generativelanguage.googleapis.com", "api.openai.com"]);

export function checkLlmBaseUrl(raw: string, trusted?: string): BaseUrlCheck {
  return checkKeyedBaseUrl(raw, KNOWN_LLM_HOSTS, trusted, "a known LLM API host", "LLM_TRUSTED_BASE_URL");
}

/**
 * Client-side spacing between LLM request starts. Gemini's free tier is limited per minute (RPM) per project and
 * answers 429 RESOURCE_EXHAUSTED past it (https://ai.google.dev/gemini-api/docs/rate-limits), so on Google's host
 * Fanpoint spaces calls 6.5 s apart (about 9/min, under a 10 RPM limit). LLM_MIN_INTERVAL_MS overrides; 0 disables.
 */
export function defaultLlmIntervalMs(baseUrl: string): number {
  try { return new URL(baseUrl).hostname === "generativelanguage.googleapis.com" ? 6500 : 0; } catch { return 0; }
}
