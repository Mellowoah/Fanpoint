/**
 * Runtime validation of OpenAI-compatible Chat Completions responses. Providers differ in small ways
 * (some send `arguments` as an object, omit `type`, or send `content: ""`), so the parser normalizes those
 * and drops tool calls it cannot use rather than failing the whole turn.
 */
import { z } from "zod";
import { ProviderError } from "../net/errors";
import type { ChatResult, ToolCall } from "./types";

const RawToolCall = z.object({
  id: z.string().min(1),
  type: z.literal("function").optional(),
  function: z.object({ name: z.string().min(1), arguments: z.union([z.string(), z.record(z.string(), z.unknown())]).optional() }),
  extra_content: z.record(z.string(), z.unknown()).optional().catch(undefined),
});
const Completion = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string().nullish(), tool_calls: z.array(z.unknown()).nullish() }),
    finish_reason: z.string().nullish(),
  })).min(1),
});

export interface ParsedCompletion extends ChatResult { droppedToolCalls: number; finishReason?: string }

export function parseChatCompletion(json: unknown): ParsedCompletion {
  const p = Completion.safeParse(json);
  if (!p.success) throw new ProviderError("llm", "invalid_response", `chat completion: ${p.error.issues[0]?.message ?? "bad shape"}`);
  const choice = p.data.choices[0]!; // .min(1) above
  const raw = choice.message.tool_calls ?? [];
  const toolCalls: ToolCall[] = [];
  for (const r of raw) {
    const t = RawToolCall.safeParse(r);
    if (!t.success) continue;
    const a = t.data.function.arguments;
    toolCalls.push({
      id: t.data.id, type: "function", function: { name: t.data.function.name, arguments: typeof a === "string" ? a : JSON.stringify(a ?? {}) },
      ...(t.data.extra_content ? { extra_content: t.data.extra_content } : {}),
    });
  }
  const content = choice.message.content?.trim() ? choice.message.content : null;
  return { content, toolCalls, droppedToolCalls: raw.length - toolCalls.length, finishReason: choice.finish_reason ?? undefined };
}

/**
 * Parse a model's JSON answer. Tolerates ```json fences and prose around a single top-level object,
 * which models emit even in JSON mode on some providers.
 */
export function parseJsonContent(text: string | null | undefined): unknown {
  if (!text || !text.trim()) throw new ProviderError("llm", "invalid_response", "empty JSON answer");
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(body); } catch { /* fall through to object extraction */ }
  const start = body.indexOf("{"), end = body.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(body.slice(start, end + 1)); } catch { /* invalid below */ } }
  throw new ProviderError("llm", "invalid_response", "answer is not valid JSON");
}

/** Parse tool-call arguments. Returns an error string instead of throwing: the model gets it back and can retry. */
export function parseToolArgs(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw.trim()) return { ok: true, value: {} };
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return { ok: true, value: v as Record<string, unknown> };
    return { ok: false, error: "Tool arguments must be a JSON object." };
  } catch { return { ok: false, error: "Tool arguments are not valid JSON." }; }
}
