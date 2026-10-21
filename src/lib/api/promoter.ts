/**
 * Promoter view (GET /api/promoter?city=&genre=): the acts whose fans have the strongest affinity in one touring city.
 * Qloo /v2/insights with filter.type=urn:entity:artist and the location as a SIGNAL (`signal.location.query`;
 * docs.qloo.com/reference/parameters lists signal.location* for artists, while filter.location* is places and
 * destinations only). An optional genre is resolved with /v2/tags (urn:tag:genre:music) and applied as filter.tags.
 * Qloo's locality match is fuzzy, so the matched locality is checked against the chosen market; if it is more than
 * LOCALITY_MAX_MI away, Fanpoint asks again with a WKT POINT at the market centre. Ranking is Qloo's order; Fanpoint only
 * drops duplicates and invalid records. Results are cached in memory; uncached live lookups are rate limited.
 */
import "server-only";
import { cacheGet, cacheSet } from "../cache";
import { findMarket } from "../data/markets";
import { isProviderError } from "../net/errors";
import { createQlooClient } from "../qloo";
import type { QlooClient, QlooRawEntity } from "../qloo/types";
import { gcMi } from "../route/geo";
import { promoterScoreLine } from "../route/score-line";

export interface PromoterAct { id: string; name: string; image?: string; detail?: string; affinity?: number; popularity?: number; scoreLine: string; mock?: boolean }
export interface PromoterResponse {
  city: string;
  genre?: { query: string; id?: string; name?: string };
  /** How the city reached Qloo: the matched locality name, or the market-centre point. */
  signal?: { kind: "locality"; name: string } | { kind: "point"; wkt: string };
  acts: PromoterAct[];
  mode: "live" | "mock";
  error?: string;
}

export const PROMOTER_TAKE = 10;
/** Ask for a few more than shown, so de-duplication still leaves ten. */
export const PROMOTER_FETCH = 15;
export const PROMOTER_LIVE_PER_MINUTE = 20;
export const LOCALITY_MAX_MI = 60;
const TTL_MS = 6 * 60 * 60 * 1000;
const MUSIC_GENRE = "urn:tag:genre:music";

let recent: number[] = [];
/** Test helper. */
export function resetPromoterBudget() { recent = []; }

const shorten = (s?: string) => (s && s.length > 90 ? `${s.slice(0, 87).trimEnd()}…` : s);
const safeImage = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);
const cleanGenre = (raw: string | null) => {
  const g = (raw ?? "").replace(/\s+/g, " ").trim();
  return g.length >= 2 && g.length <= 40 && !/[\u0000-\u001f\u007f]/.test(g) ? g : undefined;
};

export function toActs(raw: QlooRawEntity[]): PromoterAct[] {
  const seen = new Set<string>();
  return raw
    .filter((r) => !seen.has(r.entity_id) && seen.add(r.entity_id))
    .slice(0, PROMOTER_TAKE)
    .map((r) => ({
      id: r.entity_id, name: r.name,
      image: safeImage(r.properties?.image?.url),
      detail: shorten(r.properties?.short_description ?? r.properties?.description) ?? (r.tags?.length ? r.tags.slice(0, 3).map((t) => t.name).join(", ") : undefined),
      affinity: r.query?.affinity, popularity: r.popularity,
      scoreLine: promoterScoreLine(r.query?.affinity),
      mock: r._mock || undefined,
    }));
}

export async function findActs(rawCity: string | null, rawGenre: string | null, deps: { qloo?: QlooClient; now?: number } = {}): Promise<{ status: number; body: PromoterResponse }> {
  const market = rawCity && rawCity.length <= 80 ? findMarket(rawCity) : undefined;
  const client = deps.qloo ?? createQlooClient();
  const mode = client.mode;
  const genreQ = cleanGenre(rawGenre);
  if (!market) return { status: 400, body: { city: rawCity ?? "", acts: [], mode, error: "Pick a city from the touring-city list." } };
  if (rawGenre?.trim() && !genreQ) return { status: 400, body: { city: market.name, acts: [], mode, error: "Genre should be 2 to 40 characters." } };

  const key = `promoter:${mode}:${market.id}:${genreQ?.toLowerCase() ?? ""}`;
  const hit = cacheGet<PromoterResponse>(key);
  if (hit) return { status: 200, body: hit };

  if (mode === "live") {
    const now = deps.now ?? Date.now();
    recent = recent.filter((t) => now - t < 60_000);
    if (recent.length >= PROMOTER_LIVE_PER_MINUTE) return { status: 429, body: { city: market.name, acts: [], mode, error: "Too many lookups right now. Try again in a minute." } };
    recent.push(now);
  }

  try {
    let genre: PromoterResponse["genre"];
    if (genreQ) {
      const tag = (await client.tags(genreQ, [MUSIC_GENRE])).find((t) => t.id.startsWith(`${MUSIC_GENRE}:`));
      if (!tag) return { status: 200, body: { city: market.name, genre: { query: genreQ }, acts: [], mode, error: `Qloo has no music genre tag matching "${genreQ}".` } };
      genre = { query: genreQ, id: tag.id, name: tag.name };
    }
    const base = { "filter.type": "urn:entity:artist", "filter.tags": genre?.id, take: PROMOTER_FETCH };
    const place = `${market.name.replace(/, [A-Z]{2}$/, "")}, ${market.state}`;
    const first = await client.insightsLocal({ ...base, "signal.location.query": place });
    const loc = first.locality;
    const near = loc?.lat !== undefined && loc.lon !== undefined && gcMi(market, { lat: loc.lat, lon: loc.lon }) <= LOCALITY_MAX_MI;
    let entities = first.entities, signal: PromoterResponse["signal"];
    if (near && loc) signal = { kind: "locality", name: loc.name };
    else {
      const wkt = `POINT(${market.lon.toFixed(4)} ${market.lat.toFixed(4)})`;
      entities = (await client.insightsLocal({ ...base, "signal.location": wkt })).entities;
      signal = { kind: "point", wkt };
    }
    const body: PromoterResponse = { city: market.name, genre, signal, acts: toActs(entities), mode };
    cacheSet(key, body, TTL_MS);
    return { status: 200, body };
  } catch (e) {
    const msg = isProviderError(e) ? e.userMessage : "Qloo is unavailable right now.";
    return { status: 502, body: { city: market.name, acts: [], mode, error: msg } };
  }
}
