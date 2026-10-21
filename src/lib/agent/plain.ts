/**
 * "Plain AI" baseline for Fill the gaps: the same LLM, the same anchors, NO Qloo tools. Its answer is validated,
 * then audited with the same touring rules Routed enforces (drive per day, doubling back, radius clause, dates).
 * Fan-heat scoring of its cities happens in the Compare view, against the Qloo corridor reads from the same run.
 */
import { z } from "zod";
import { createLlmClient, type LlmClient } from "../llm";
import { ProviderError } from "../net/errors";
import { findCity } from "../route/cities";
import { auditSequence, isIsoDate } from "../route/fill";
import { osrmRoads } from "../route/road";
import { toErrorEvent } from "./errors";
import { fillParams, resolveAnchors } from "./run";
import type { AgentEvent, AuditRow, FillRequest, PlainFillPlan, PlainStop } from "./types";

const PlainStopSchema = z.object({
  date: z.string().refine(isIsoDate, "date must be yyyy-mm-dd"),
  city: z.string().trim().min(1).max(80),
  venue: z.string().max(200).catch("(no venue given)"),
  why: z.string().max(800).catch(""),
});
const PlainAnswerSchema = z.object({ summary: z.string().max(1000).catch(""), stops: z.array(z.unknown()).max(60), _simulated: z.literal(true).optional().catch(undefined) });

/** Validate a plain-AI answer: the envelope must match; individual malformed stops are dropped and counted. */
function parsePlainAnswer(raw: unknown): { summary: string; stops: z.infer<typeof PlainStopSchema>[]; dropped: number; simulated: boolean } {
  // Gemini in JSON mode sometimes returns the stops array itself, or the requested object wrapped in an array.
  if (Array.isArray(raw)) {
    const only = raw.length === 1 && raw[0] && typeof raw[0] === "object" && "stops" in raw[0] ? raw[0] : undefined;
    raw = only ?? { summary: "", stops: raw };
  }
  const p = PlainAnswerSchema.safeParse(raw);
  if (!p.success) throw new ProviderError("llm", "invalid_response", `plain answer: ${p.error.issues[0]?.message ?? "bad shape"}`);
  const stops = p.data.stops.flatMap((s) => { const r = PlainStopSchema.safeParse(s); return r.success ? [r.data] : []; });
  return { summary: p.data.summary, stops, dropped: p.data.stops.length - stops.length, simulated: p.data._simulated === true };
}

/** Longest run of consecutive calendar days with a show (ISO dates; duplicates count once). */
export function longestShowRun(dates: readonly string[]): number {
  const days = [...new Set(dates.filter(isIsoDate))].map((d) => Date.parse(`${d}T00:00:00Z`) / 86_400_000).sort((a, b) => a - b);
  let best = 0, run = 0;
  days.forEach((d, i) => { run = i > 0 && d - days[i - 1]! === 1 ? run + 1 : 1; best = Math.max(best, run); });
  return best;
}

export async function* runPlainFill(req: FillRequest, deps: { llm?: LlmClient } = {}): AsyncGenerator<AgentEvent> {
  const label = "Ask the LLM directly (no Qloo)";
  try {
    const llm = deps.llm ?? createLlmClient();
    const anchors = resolveAnchors(req);
    yield { type: "step", id: "plain", label, status: "running" };
    const answer = parsePlainAnswer(await llm.json(
      `You are a booking agent's assistant. Answer from general knowledge only. Return JSON: {"summary": string, "stops": [{"date": "YYYY-MM-DD", "city": string (US city name only), "venue": string, "why": string}]}`,
      `Artist "${req.artist}" has these fixed shows: ${anchors.map((a) => `${a.date} ${a.city}`).join("; ")}. Fill the off days in between with shows. The band drives one van.\nREQUEST_JSON:${JSON.stringify({ anchors })}`,
    ));
    const all: PlainStop[] = answer.stops.map((s) => {
      const c = findCity(s.city);
      return c ? { ...s, id: c.id, city: c.name, region: c.region, lat: c.lat, lon: c.lon } : s;
    }).sort((a, b) => a.date.localeCompare(b.date));
    // Models often restate the fixed shows inside "stops". Those are not proposals, so they are not audited as fills.
    const sameCity = (x: string, y: string) => (findCity(x)?.id ?? x.toLowerCase()) === (findCity(y)?.id ?? y.toLowerCase());
    const proposed = all.filter((s) => !anchors.some((a) => a.date === s.date && sameCity(a.city, s.city)));
    const repeated = all.length - proposed.length;
    const stops = proposed;
    const params = fillParams(req);
    const roads = osrmRoads();
    const mapped = stops.flatMap((s) => (s.lat !== undefined && s.lon !== undefined ? [{ ...s, lat: s.lat, lon: s.lon }] : []));
    const audit: AuditRow[] = auditSequence(anchors, mapped, params, roads.leg).map((r) => ({ ...r, mapped: true }));
    for (const s of stops) if (s.lat === undefined) audit.push({ city: s.city, date: s.date, anchor: false, overDrive: false, doublesBack: false, mapped: false });
    const warnings = answer.dropped ? [`${answer.dropped} malformed stop(s) in the plain-AI answer were ignored.`] : [];
    if (repeated) warnings.push(`${repeated} stop(s) in the plain-AI answer repeated the fixed shows and were not counted as fills.`);
    const longestRun = longestShowRun([...anchors.map((a) => a.date), ...stops.map((s) => s.date)]);
    const maxRun = params.maxConsecutiveShows;
    if (maxRun !== undefined && longestRun > maxRun) warnings.push(`The plain-AI plan has ${longestRun} shows in a row (limit ${maxRun}, then a day off).`);
    const plan: PlainFillPlan = {
      task: "fill", mode: "plain", artist: req.artist, anchors, params, stops, audit, warnings, routing: roads.meta,
      summary: answer.summary, providers: { llm: llm.mode, model: llm.model }, simulated: answer.simulated, longestRun,
    };
    const bad = audit.filter((a) => a.overDrive || a.doublesBack || a.radiusConflict || a.dateConflict).length;
    yield { type: "step", id: "plain", label, status: "done", detail: `${stops.length} fills, ${bad} break touring rules, 0 backed by data` };
    yield { type: "result", plan };
  } catch (e) {
    yield { type: "step", id: "plain", label, status: "error" };
    yield toErrorEvent(e);
  }
}
