/**
 * Runtime validation of Qloo responses (zod). Shapes follow the Qloo docs (docs.qloo.com, "Insights API",
 * "Heatmaps use case"). Strategy, so one odd record never sinks a run:
 *   - the envelope must match, otherwise the call fails with `invalid_response` (callers degrade per tool);
 *   - each list item is validated on its own; invalid items are dropped and counted (shown in the trace);
 *   - optional fields that come back in an unexpected type are treated as absent (`.catch(undefined)`).
 * Tolerances copied in spirit (not code) from Qloo's own harness client (@qloo/qloo-harness 0.1.26, MIT), which
 * reads every list as `results` (array) or `results.<key>`, entity ids as `entity_id` or `id`, and tag types as
 * `type` or `subtype`. Fanpoint accepts the same variants so a live shape difference degrades nothing.
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
    /** Place fields (verified live on urn:entity:place, 2026-10-21). */
    address: optStr, website: optStr, phone: optStr, neighborhood: optStr,
    primary_genre: z.object({ id: optStr, name: optStr }).optional().catch(undefined),
    physical_setting_description: optStr, unique_selling_points: optStr,
    /** Entity image, when Qloo has one (used only for the autocomplete thumbnail). */
    image: z.object({ url: optStr }).optional().catch(undefined),
  }).optional().catch(undefined),
  tags: z.array(RawTagSchema).optional().catch(undefined),
  query: z.object({ affinity: optNum }).optional().catch(undefined),
  /** Present only on Fanpoint's mock fixtures. */
  _mock: z.literal(true).optional().catch(undefined),
}));
export type QlooRawEntity = z.infer<typeof RawEntitySchema>;

/** One heatmap grid point. affinity is required: a cell without it carries no signal and is dropped, not zeroed. */
export const RawHeatCellSchema = z.object({
  location: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), geohash: optStr }),
  query: z.object({ affinity: z.number().min(0).max(1), affinity_rank: optNum, popularity: optNum }),
});
export type QlooRawHeatCell = z.infer<typeof RawHeatCellSchema>;

/** Polygon rings are only averaged for strings up to this length (a neighborhood); country outlines are skipped. */
const CENTROID_MAX_CHARS = 200_000;
/** Centre of a WKT POINT, or the bounding-box centre of a small POLYGON/MULTIPOLYGON. Lon-lat order, as Qloo sends. */
export function wktCentre(wkt: string): { lat: number; lon: number } | undefined {
  const pt = /^\s*POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)/i.exec(wkt);
  if (pt) return { lon: Number(pt[1]), lat: Number(pt[2]) };
  if (wkt.length > CENTROID_MAX_CHARS || !/^\s*(MULTI)?POLYGON/i.test(wkt)) return undefined;
  let la0 = 90, la1 = -90, lo0 = 180, lo1 = -180, n = 0;
  for (const m of wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
    const lo = Number(m[1]), la = Number(m[2]);
    la0 = Math.min(la0, la); la1 = Math.max(la1, la); lo0 = Math.min(lo0, lo); lo1 = Math.max(lo1, lo); n++;
  }
  return n ? { lat: (la0 + la1) / 2, lon: (lo0 + lo1) / 2 } : undefined;
}
/**
 * One named locality from a heatmap with output.heatmap.boundary=urn:entity:locality (verified live). The response
 * mixes the country, states, counties, cities and neighborhoods, each with its full boundary polygon (5-16 MB per
 * response). The geometry is reduced to a centre point here and never stored or sent on.
 */
export const RawLocalityHeatSchema = z.object({
  name: z.string().min(1), entity_id: z.string().min(1), popularity: optNum, disambiguation: z.string().default(""),
  query: z.object({ affinity: z.number().min(0).max(1) }),
  boundary: z.string().optional().catch(undefined),
}).transform(({ boundary, disambiguation, ...r }) => {
  const parts = disambiguation.split(",").map((x) => x.trim()).filter(Boolean);
  // Live: "<Hood>, <District or City>, <County>, <State>, <Country>" (the second part is a district in some cities and
  // the city itself in others); a city has four parts. Five or more = below city level; `city` keeps the
  // parent area (a district or the city), shown next to the name.
  const hood = parts.length >= 5;
  const c = hood && boundary ? wktCentre(boundary) : undefined;
  return { id: r.entity_id, name: r.name, affinity: r.query.affinity, popularity: r.popularity, level: hood ? "neighborhood" as const : "area" as const, city: hood ? parts[parts.length - 4] : undefined, lat: c?.lat, lon: c?.lon };
});
export type LocalityHeat = z.output<typeof RawLocalityHeatSchema>;

/** urn:demographics item: age-bucket and gender skews per entity. */
const SkewMap = z.record(z.string(), z.number().finite());
export const RawDemographicsSchema = z.object({ entity_id: z.string().min(1), query: z.object({ age: SkewMap.default({}), gender: SkewMap.default({}) }) })
  .transform((d) => ({ entityId: d.entity_id, age: d.query.age, gender: d.query.gender }));
/** A scored tag: urn:tag taste analysis (query.affinity) or /v2/analysis/compare (query.score). Unscored tags are dropped. */
export const RawScoredTagSchema = z.object({ id: optStr, tag_id: optStr, name: z.string().min(1), subtype: optStr, type: optStr, query: z.object({ affinity: optNum, score: optNum }).optional().catch(undefined) })
  .transform((t, ctx) => {
    const id = t.tag_id ?? t.id, score = t.query?.affinity ?? t.query?.score;
    if (!id || score === undefined) { ctx.addIssue({ code: "custom", message: "tag without id or score" }); return z.NEVER; }
    return { id, name: t.name, subtype: t.subtype ?? (t.type !== "urn:tag" ? t.type : undefined), score };
  });

const list = z.array(z.unknown());
/** `{ results: [...] }` or `{ results: { <key>: [...] } }`, normalized to the array. */
const envelopeOf = (key: string) =>
  z.object({ results: z.union([list, z.object({ [key]: list }).transform((r) => r[key] as unknown[])]) }).transform((e) => e.results);
const InsightsEnvelope = envelopeOf("entities");
const HeatmapEnvelope = envelopeOf("heatmap");
const SearchEnvelope = envelopeOf("entities");
const TagsEnvelope = envelopeOf("tags");
const DemographicsEnvelope = envelopeOf("demographics");

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
const LocalitySchema = z.object({ query: z.object({ localities: z.object({ signal: z.object({ name: z.string(), location: z.object({ lat: optNum, lon: optNum }).optional().catch(undefined) }) }) }) });
/** Insights entities plus `query.localities.signal` (the locality Qloo matched for signal.location.query), as one item. */
export function parseInsightsLocal(json: unknown): Parsed<{ entities: QlooRawEntity[]; locality?: { name: string; lat?: number; lon?: number } }> {
  const p = parseInsights(json);
  const l = LocalitySchema.safeParse(json);
  const locality = l.success ? { name: l.data.query.localities.signal.name, lat: l.data.query.localities.signal.location?.lat, lon: l.data.query.localities.signal.location?.lon } : undefined;
  return { items: [{ entities: p.items, locality }], dropped: p.dropped };
}
export const parseLocalityHeat = (json: unknown) => items(envelope(json, InsightsEnvelope, "locality heatmap"), RawLocalityHeatSchema);
export const parseDemographics = (json: unknown) => items(envelope(json, DemographicsEnvelope, "demographics"), RawDemographicsSchema);
export const parseScoredTags = (json: unknown) => items(envelope(json, TagsEnvelope, "tags"), RawScoredTagSchema);
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
  const o = r as { entities?: unknown; tags?: unknown; heatmap?: unknown; demographics?: unknown };
  const l = o.entities ?? o.tags ?? o.heatmap ?? o.demographics;
  return Array.isArray(l) ? l.length : 0;
}
