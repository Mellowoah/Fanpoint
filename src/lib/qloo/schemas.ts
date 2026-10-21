/**
 * Runtime validation of Qloo responses (zod). Shapes follow the Qloo docs (docs.qloo.com, "Insights API",
 * "Heatmaps use case"). Strategy, so one odd record never sinks a run:
 *   - the envelope must match, otherwise the call fails with `invalid_response` (callers degrade per tool);
 *   - each list item is validated on its own; invalid items are dropped and counted (shown in the trace);
 *   - optional fields that come back in an unexpected type are treated as absent (`.catch(undefined)`).
 * Tolerances copied in spirit (not code) from Qloo's own harness client (@qloo/qloo-harness 0.1.26, MIT), which
 * reads every list as `results` (array) or `results.<key>`, entity ids as `entity_id` or `id`, and tag types as
 * `type` or `subtype`. Routed accepts the same variants so a live shape difference degrades nothing.
 */
import { z } from "zod";
import { ProviderError } from "../net/errors";

const optNum = z.number().finite().optional().catch(undefined);
const optStr = z.string().optional().catch(undefined);

export const RawTagSchema = z.object({ id: optStr, tag_id: optStr, name: z.string(), type: optStr, subtype: optStr });

/** Copy a bare `id` into `entity_id` when only the former is present (the harness accepts either). */
const withEntityId = (v: unknown): unknown => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return v;
  const o = v as Record<string, unknown>;
  return o.entity_id === undefined && typeof o.id === "string" ? { ...o, entity_id: o.id } : v;
};

export const RawEntitySchema = z.preprocess(withEntityId, z.object({
  name: z.string().min(1),
  entity_id: z.string().min(1),
  type: optStr,
  subtype: optStr,
  types: z.array(z.string()).optional().catch(undefined),
  popularity: optNum,
  location: z.object({ lat: optNum, lon: optNum, geohash: optStr }).optional().catch(undefined),
  properties: z.object({
    geocode: z.object({ name: optStr, admin1_region: optStr, country_code: optStr, city: optStr }).optional().catch(undefined),
    short_description: optStr,
    description: optStr,
    /** Entity image, when Qloo has one (used only for the autocomplete thumbnail). */
    image: z.object({ url: optStr }).optional().catch(undefined),
  }).optional().catch(undefined),
  tags: z.array(RawTagSchema).optional().catch(undefined),
  query: z.object({ affinity: optNum }).optional().catch(undefined),
  /** Present only on Routed's mock fixtures. */
  _mock: z.literal(true).optional().catch(undefined),
}));
export type QlooRawEntity = z.infer<typeof RawEntitySchema>;

/** One heatmap grid point. affinity is required: a cell without it carries no signal and is dropped, not zeroed. */
export const RawHeatCellSchema = z.object({
  location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), geohash: optStr }),
  query: z.object({ affinity: z.number().min(0).max(1), affinity_rank: optNum, popularity: optNum }),
});
export type QlooRawHeatCell = z.infer<typeof RawHeatCellSchema>;

const list = z.array(z.unknown());
/** `{ results: [...] }` or `{ results: { <key>: [...] } }`, normalized to the array. */
const envelopeOf = (key: string) =>
  z.object({ results: z.union([list, z.object({ [key]: list }).transform((r) => r[key] as unknown[])]) }).transform((e) => e.results);
const InsightsEnvelope = envelopeOf("entities");
const HeatmapEnvelope = envelopeOf("heatmap");
const SearchEnvelope = envelopeOf("entities");
const TagsEnvelope = envelopeOf("tags");

export interface Parsed<T> { items: T[]; dropped: number }

function items<T>(raw: unknown[], schema: z.ZodType<T>): Parsed<T> {
  const out: T[] = [];
  for (const r of raw) { const p = schema.safeParse(r); if (p.success) out.push(p.data); }
  return { items: out, dropped: raw.length - out.length };
}
function envelope<T>(json: unknown, schema: z.ZodType<T>, what: string): T {
  const p = schema.safeParse(json);
  if (!p.success) throw new ProviderError("qloo", "invalid_response", `${what}: ${p.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ").slice(0, 200)}`);
  return p.data;
}

export const parseInsights = (json: unknown): Parsed<QlooRawEntity> => items(envelope(json, InsightsEnvelope, "insights"), RawEntitySchema);
export const parseSearch = (json: unknown): Parsed<QlooRawEntity> => items(envelope(json, SearchEnvelope, "search"), RawEntitySchema);
export const parseHeatmap = (json: unknown): Parsed<QlooRawHeatCell> => items(envelope(json, HeatmapEnvelope, "heatmap"), RawHeatCellSchema);
/** Tags need an id (`id` or legacy `tag_id`); tags without one are dropped. */
export function parseTags(json: unknown): Parsed<{ id: string; name: string }> {
  const p = items(envelope(json, TagsEnvelope, "tags"), RawTagSchema);
  const ok = p.items.flatMap((t) => { const id = t.id ?? t.tag_id; return id ? [{ id, name: t.name }] : []; });
  return { items: ok, dropped: p.dropped + (p.items.length - ok.length) };
}

/** Results in a parsed body, for the call log (works for every envelope above). */
export function countResults(json: unknown): number {
  if (typeof json !== "object" || json === null) return 0;
  const r = (json as { results?: unknown }).results;
  if (Array.isArray(r)) return r.length;
  if (typeof r !== "object" || r === null) return 0;
  const o = r as { entities?: unknown; tags?: unknown; heatmap?: unknown };
  const l = o.entities ?? o.tags ?? o.heatmap;
  return Array.isArray(l) ? l.length : 0;
}
