import "server-only";
import { getConfig } from "../config";
import { MockLlmClient } from "./mock";
import { DEFAULT_LLM_RETRY, OpenAICompatibleClient } from "./openai-compatible";
import type { LlmClient } from "./types";

/** Factory: live OpenAI-compatible client when LLM_API_KEY is set, otherwise the scripted mock. */
export function createLlmClient(): LlmClient {
  const c = getConfig().llm;
  return c.mode === "live" && c.apiKey ? new OpenAICompatibleClient(c.apiKey, c.baseUrl, c.model, DEFAULT_LLM_RETRY, {}, { trustedBaseUrl: c.trustedBaseUrl, minIntervalMs: c.minIntervalMs }) : new MockLlmClient();
}
export * from "./types";
