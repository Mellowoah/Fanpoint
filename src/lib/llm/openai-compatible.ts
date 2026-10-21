import "server-only";
import { ProviderError } from "../net/errors";
import { requestWithRetry, type HttpDeps, type RetryPolicy } from "../net/http";
import { sharedLimiter } from "../net/rate-limiter";
import { checkLlmBaseUrl, defaultLlmIntervalMs } from "./base-url";
import { parseChatCompletion, parseJsonContent } from "./schemas";
import type { ChatMessage, ChatResult, LlmClient, ToolDef } from "./types";

/**
 * 3 retries, waits capped at 30 s: enough to ride out a free-tier per-minute 429 (Gemini says how long to wait in
 * Retry-After or the body's RetryInfo.retryDelay, which requestWithRetry honours) without blowing the run deadline.
 */
export const DEFAULT_LLM_RETRY: RetryPolicy = { retries: 3, baseDelayMs: 1000, maxDelayMs: 30000, timeoutMs: 45000 };

export interface LlmClientOptions { trustedBaseUrl?: string; minIntervalMs?: number }

/** Live adapter for any OpenAI-compatible /chat/completions endpoint with function calling. */
export class OpenAICompatibleClient implements LlmClient {
  readonly mode = "live" as const;
  private readonly url: string;
  private readonly deps: HttpDeps;
  constructor(private readonly apiKey: string, baseUrl: string, readonly model: string, private readonly retry: RetryPolicy = DEFAULT_LLM_RETRY, deps: HttpDeps = {}, opts: LlmClientOptions = {}) {
    const check = checkLlmBaseUrl(baseUrl, opts.trustedBaseUrl);
    // Refuse before any request: LLM_API_KEY must never be sent to an unapproved host.
    if (!check.ok) throw new ProviderError("llm", "config", `LLM_BASE_URL ${check.reason}`);
    if (!apiKey.trim()) throw new ProviderError("llm", "config", "LLM_API_KEY is empty");
    this.url = `${check.url}/chat/completions`;
    const interval = opts.minIntervalMs ?? defaultLlmIntervalMs(check.url);
    this.deps = interval > 0 ? { limiter: sharedLimiter(`llm:${check.url}`, interval), ...deps } : deps;
  }

  private async post(body: Record<string, unknown>): Promise<unknown> {
    const res = await requestWithRetry("llm", this.url, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, temperature: 0.3, ...body }),
      cache: "no-store",
    }, this.retry, this.deps);
    try { return JSON.parse(res.text); } catch { return undefined; } // parseChatCompletion reports the bad shape
  }

  async chat(messages: ChatMessage[], tools: ToolDef[]): Promise<ChatResult> {
    const r = parseChatCompletion(await this.post({ messages, tools, tool_choice: "auto" }));
    return { content: r.content, toolCalls: r.toolCalls };
  }

  async json(system: string, user: string): Promise<unknown> {
    const r = parseChatCompletion(await this.post({
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    }));
    return parseJsonContent(r.content);
  }
}
