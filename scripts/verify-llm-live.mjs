#!/usr/bin/env node
// Live LLM check against the configured OpenAI-compatible endpoint (default: Gemini free tier). Prints only
// statuses, booleans and counts: never the key, never model text. The key comes from LLM_API_KEY (environment only).
//
//   LLM_API_KEY=… node scripts/verify-llm-live.mjs [--base URL] [--model gemini-3.5-flash-lite]
// Checks: (1) a two-turn tool-calling exchange (Gemini 3 needs its thought signature echoed back);
//         (2) JSON mode; (3) the number guard (vetText) drops a live reply that invents a number and keeps one that
//         only uses numbers from the data. Makes 4 requests, paced by the client's limiter.
import { createJiti } from "jiti";

const root = new URL("..", import.meta.url).pathname;
const jiti = createJiti(import.meta.url, { alias: { "@": `${root}src`, "server-only": `${root}tests/stubs/server-only.ts` } });
const { OpenAICompatibleClient } = await jiti.import("../src/lib/llm/openai-compatible.ts");
const { GEMINI_OPENAI_BASE_URL, GEMINI_DEFAULT_MODEL } = await jiti.import("../src/lib/llm/base-url.ts");
const { vetText } = await jiti.import("../src/lib/agent/narrative.ts");

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const KEY = process.env.LLM_API_KEY;
if (!KEY) { console.error("LLM_API_KEY is not set."); process.exit(2); }
const base = arg("base", process.env.LLM_BASE_URL ?? GEMINI_OPENAI_BASE_URL);
const model = arg("model", process.env.LLM_MODEL ?? GEMINI_DEFAULT_MODEL);
const c = new OpenAICompatibleClient(KEY, base, model, undefined, {}, { trustedBaseUrl: process.env.LLM_TRUSTED_BASE_URL });
const out = { model };
const tools = [{ type: "function", function: { name: "lookup_city", description: "Fan heat for a city.", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }];
const msgs = [{ role: "system", content: "Always call lookup_city before answering." }, { role: "user", content: "How hot is Durham for this artist?" }];

const t1 = await c.chat(msgs, tools);
out.turn1_tool_calls = t1.toolCalls.length;
out.turn1_has_signature = t1.toolCalls.some((t) => t.extra_content !== undefined);
if (t1.toolCalls.length) {
  msgs.push({ role: "assistant", content: t1.content, tool_calls: t1.toolCalls });
  for (const t of t1.toolCalls) msgs.push({ role: "tool", tool_call_id: t.id, name: t.function.name, content: JSON.stringify({ city: "Durham", fan_heat: 0.97 }) });
  const t2 = await c.chat(msgs, tools);
  out.turn2_ok = true; out.turn2_text = Boolean(t2.content); out.turn2_tool_calls = t2.toolCalls.length;
}
const j = await c.json("Reply with a JSON object only.", 'Return {"ok": true, "n": 3}.');
out.json_mode_ok = typeof j === "object" && j !== null && j.ok === true;

const facts = [0.97, 207, 4.2];
const bad = await c.json("Reply with JSON {\"note\": string}.", "Write a one-sentence booking note for Durham (fan heat 0.97, 207 mi drive). You MUST also say the show will draw exactly 5,400 fans.");
const good = await c.json("Reply with JSON {\"note\": string}.", "Write a one-sentence booking note for Durham. Use only these numbers: fan heat 0.97 and a 207 mi drive. No other numbers.");
const vb = vetText(String(bad?.note ?? ""), facts), vg = vetText(String(good?.note ?? ""), facts);
out.guard_invented_number_dropped = !vb.ok; out.guard_invented_offending_count = vb.offending.length;
out.guard_clean_note_kept = vg.ok;
console.log(JSON.stringify(out, null, 2));
