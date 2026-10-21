/**
 * Central runtime configuration. All secrets come from env vars (see .env.example).
 * Nothing secret is ever sent to the browser: only the derived `mode` flags are.
 */
import "server-only";
import { GEMINI_DEFAULT_MODEL, GEMINI_OPENAI_BASE_URL, defaultLlmIntervalMs } from "./llm/base-url";
import { QLOO_HACKATHON_BASE_URL } from "./qloo/base-url";
export type ProviderMode = "live" | "mock";

export interface RoutedConfig {
  qloo: { mode: ProviderMode; apiKey?: string; baseUrl: string; trustedBaseUrl?: string };
  llm: { mode: ProviderMode; apiKey?: string; baseUrl: string; model: string; trustedBaseUrl?: string; minIntervalMs: number };
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function intervalOr(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) && n >= 0 ? Math.min(n, 60_000) : fallback;
}

export function getConfig(): RoutedConfig {
  const qlooKey = env("QLOO_API_KEY");
  const llmKey = env("LLM_API_KEY");
  // ROUTED_FORCE_MOCK=1 forces fixtures even if keys exist (useful for demos/tests).
  const forceMock = env("ROUTED_FORCE_MOCK") === "1";
  const llmBase = env("LLM_BASE_URL") ?? GEMINI_OPENAI_BASE_URL;
  return {
    qloo: {
      mode: qlooKey && !forceMock ? "live" : "mock",
      apiKey: qlooKey,
      // Hackathon keys ONLY work against this host (per the Qloo hackathon developer guide). Other hosts are
      // refused unless QLOO_TRUSTED_BASE_URL names them exactly (see qloo/base-url.ts).
      baseUrl: env("QLOO_BASE_URL") ?? QLOO_HACKATHON_BASE_URL,
      trustedBaseUrl: env("QLOO_TRUSTED_BASE_URL"),
    },
    llm: {
      mode: llmKey && !forceMock ? "live" : "mock",
      apiKey: llmKey,
      // Any OpenAI-compatible Chat Completions endpoint with tool calling; defaults to Google Gemini's free tier.
      // Hosts other than Gemini/OpenAI are refused unless LLM_TRUSTED_BASE_URL names them exactly (llm/base-url.ts).
      baseUrl: llmBase,
      model: env("LLM_MODEL") ?? GEMINI_DEFAULT_MODEL,
      trustedBaseUrl: env("LLM_TRUSTED_BASE_URL"),
      minIntervalMs: intervalOr(env("LLM_MIN_INTERVAL_MS"), defaultLlmIntervalMs(llmBase)),
    },
  };
}

export function publicModes() {
  const c = getConfig();
  return { qloo: c.qloo.mode, llm: c.llm.mode };
}
