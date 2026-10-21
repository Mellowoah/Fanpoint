/**
 * Input validation for POST /api/plan. Strict objects (unknown keys are rejected), trimmed strings,
 * real calendar dates, and tour-shape limits, so the agent never sees a request it can't route.
 */
import { z } from "zod";
import { findCity } from "../route/cities";
import { daysBetween, isIsoDate } from "../route/fill";
import { RULES } from "../touring/rules";

/** Overrides for the adjustable touring assumptions (see touring/rules.ts). Ranges keep the DP meaningful. */
export const RuleOverrides = z.strictObject({
  maxDriveHours: z.number().min(2).max(10).optional(), // 10 h = the federal ceiling for passenger-carrier drivers
  maxConsecutiveShows: z.number().int().min(1).max(12).optional(), // 12 = AFM Pamphlet B's outer limit between days off
  radiusMi: z.number().min(0).max(300).optional(), // 300 mi = festival-scale clauses
  nightFloor: z.number().min(0).max(0.95).optional(),
  dowWeights: z.array(z.number().min(0).max(1)).length(7).optional(),
});
export type RuleOverrides = z.infer<typeof RuleOverrides>;

/** Largest body we accept (a 4-anchor request is ~600 bytes). */
export const MAX_BODY_BYTES = 8 * 1024;
/** Longest first-to-last-anchor span. Keeps the DP and the Qloo call count bounded. */
export const MAX_TOUR_DAYS = 45;

// Printable text only: no control characters (they end up in prompts and the trace).
const text = (max: number) => z.string().trim().max(max).refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "contains control characters");
const name = text(120).pipe(z.string().min(1, "required"));

const Anchor = z.strictObject({
  city: text(80).refine((c) => !!findCity(c), "pick a city from the touring-city list"),
  date: z.string().refine(isIsoDate, "must be a real date (yyyy-mm-dd)"),
  label: text(40).optional(),
});

const Fill = z.strictObject({
  task: z.literal("fill"),
  artist: name,
  anchors: z.array(Anchor).min(2, "at least 2 anchor dates").max(4, "at most 4 anchor dates"),
  maxDriveMi: z.number().int().min(100).max(700).default(RULES.maxDriveMi.value),
  minAffinity: z.number().min(0).max(1).default(RULES.minAffinity.value),
  rules: RuleOverrides.optional(),
  mode: z.enum(["qloo", "plain"]).default("qloo"),
}).superRefine((r, ctx) => {
  const dates = r.anchors.map((a) => a.date);
  if (new Set(dates).size !== dates.length) ctx.addIssue({ code: "custom", path: ["anchors"], message: "anchor dates must differ" });
  const cities = r.anchors.map((a) => findCity(a.city)?.name ?? a.city);
  if (new Set(cities).size !== cities.length) ctx.addIssue({ code: "custom", path: ["anchors"], message: "each anchor city can appear only once" });
  const sorted = [...dates].sort();
  const first = sorted[0], last = sorted[sorted.length - 1];
  if (first && last && isIsoDate(first) && isIsoDate(last) && daysBetween(first, last) > MAX_TOUR_DAYS)
    ctx.addIssue({ code: "custom", path: ["anchors"], message: `first to last anchor must be within ${MAX_TOUR_DAYS} days` });
});

const Cohead = z.strictObject({
  task: z.literal("cohead"),
  artist: name,
  partner: text(120).optional().transform((v) => v || undefined),
  mode: z.literal("qloo").default("qloo"),
});

export const PlanBody = z.discriminatedUnion("task", [Fill, Cohead]);
export type PlanBody = z.infer<typeof PlanBody>;

export interface ApiError { error: { code: "invalid_request" | "unsupported_media_type" | "payload_too_large" | "invalid_json"; message: string; issues?: { path: string; message: string }[] } }

/** Validate a raw request. Returns either the parsed body or an HTTP status + error payload. */
export async function readPlanRequest(request: Request): Promise<{ ok: true; body: PlanBody } | { ok: false; status: number; payload: ApiError }> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type)) return { ok: false, status: 415, payload: { error: { code: "unsupported_media_type", message: "Send JSON (content-type: application/json)." } } };
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return tooLarge();
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return tooLarge();
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return { ok: false, status: 400, payload: { error: { code: "invalid_json", message: "Request body is not valid JSON." } } }; }
  const p = PlanBody.safeParse(json);
  if (!p.success) {
    const issues = p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    return { ok: false, status: 400, payload: { error: { code: "invalid_request", message: issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; "), issues } } };
  }
  return { ok: true, body: p.data };
}
const tooLarge = () => ({ ok: false as const, status: 413, payload: { error: { code: "payload_too_large" as const, message: `Request body over ${MAX_BODY_BYTES} bytes.` } } });
