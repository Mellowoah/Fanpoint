/** OpenAI-compatible chat message + tool shapes (works with OpenAI, OpenRouter, Together, Groq, vLLM, etc.). */
export type Role = "system" | "user" | "assistant" | "tool";
export interface ToolCall {
  id: string; type: "function"; function: { name: string; arguments: string };
  /**
   * Provider-specific data that must be sent back unchanged with the assistant turn. Gemini's OpenAI-compatible
   * endpoint puts a thought signature here (extra_content.google.thought_signature) and answers 400 on the next
   * turn if it is missing. Opaque: never shown, logged or parsed.
   */
  extra_content?: Record<string, unknown>;
}
export interface ChatMessage { role: Role; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; name?: string }
export interface ToolDef { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface ChatResult { content: string | null; toolCalls: ToolCall[] }

export interface LlmClient {
  readonly mode: "live" | "mock";
  readonly model: string;
  /** Agentic turn with tools. */
  chat(messages: ChatMessage[], tools: ToolDef[]): Promise<ChatResult>;
  /** Single JSON completion with NO tools and NO Qloo data (the "plain AI" baseline). */
  json(system: string, user: string): Promise<unknown>;
}
