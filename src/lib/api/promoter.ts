/**
 * Promoter view (GET /api/promoter?city=&genre=): the acts whose fans have the strongest affinity in one touring city.
 * Qloo /v2/insights with filter.type=urn:entity:artist and the location as a SIGNAL (`signal.location.query`;
 * docs.qloo.com/reference/parameters lists signal.location* for artists, while filter.location* is places and
 * destinations only). An optional genre is resolved with /v2/tags (urn:tag:genre:music) and applied as filter.tags.
 * Qloo's locality match is fuzzy, so the matched locality is checked against the chosen market; if it is more than
 * LOCALITY_MAX_MI away, Fanpoint asks again with a WKT POINT at the market centre. Ranking is Qloo's order; Fanpoint only
 * drops duplicates and invalid records. Results are cached in memory; uncached live lookups are rate limited.
 *
 * Each city lookup also returns the city's show rooms (places on the venue whitelist, market-centre POINT + radius) and a
 * one-line taste profile (filter.type=urn:tag, music genres, city as the signal). Both degrade to empty on failure.
 * "Who fits this room" (GET /api/promoter/room?city=&venue=) ranks artists with that room as the signal; only acts with a
 * music genre tag are kept (the room's crowd also likes TV personalities and podcasters).
 */
import "server-only";
import { cacheGet, cacheSet } from "../cache";
import { findMarket } from "../data/markets";
import { isProviderError } from "../net/errors";
import { createQlooClient } from "../qloo";
import type { QlooClient, QlooRawEntity } from "../qloo/types";
import { normalize } from "../qloo/normalize";
import { isMusicAct, tasteLine } from "../qloo/taste";
import { isShowRoom, tierOf, VENUE_FETCH, VENUE_RADIUS_M, VENUE_TAGS, type VenueTier } from "../qloo/venues";
import type { Market } from "../data/markets";
import { gcMi } from "../route/geo";
import { promoterScoreLine } from "../route/score-line";

export interface PromoterAct { id: string; name: string; image?: string; detail?: string; affinity?: number; popularity?: number; scoreLine: string; mock?: boolean }
export interface PromoterResponse {
  city: string;
  genre?: { query: string; id?: string; name?: string };
  /** How the city reached Qloo: the matched locality name, or the market-centre point. */
  signal?: { kind: "locality"; name: string } | { kind: "point"; wkt: string };
  acts: PromoterAct[];
  /** Show rooms in the city (whitelisted categories), for "who fits this room". */
  rooms?: PromoterRoom[];
  /** Music genres the city's audience over-indexes on (Qloo taste analysis), strongest first. */
  taste?: string[];
  mode: "live" | "mock";
  error?: string;
}
export interface PromoterRoom { id: string; name: string; tier?: VenueTier; address?: string; neighborhood?: string }
export interface RoomActsResponse { city: string; room?: PromoterRoom; acts: PromoterAct[]; dropped?: number; mode: "live" | "mock"; error?: string }

export const PROMOTER_TAKE = 10;
/** Ask for a few more than shown, so de-duplication still leaves ten. */
export const PROMOTER_FETCH = 15;
export const PROMOTER_LIVE_PER_MINUTE = 20;
export const LOCALITY_MAX_MI = 60;
export const ROOMS_SHOWN = 8;
const VENUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
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

/** Spend one live lookup from the shared per-minute budget; false when it is used up. */
function spend(mode: "live" | "mock", now: number): boolean {
  if (mode !== "live") return true;
  recent = recent.filter((t) => now - t < 60_000);
  if (recent.length >= PROMOTER_LIVE_PER_MINUTE) return false;
  recent.push(now);
  return true;
}
const BUSY = "Too many lookups right now. Try again in a minute.";
const wktOf = (m: Market) => `POINT(${m.lon.toFixed(4)} ${m.lat.toFixed(4)})`;

/** Show rooms near the market centre, cached per market. Most popular first (Qloo's order without a taste signal). */
async function roomsFor(client: QlooClient, market: Market): Promise<PromoterRoom[]> {
  const key = `promoter-rooms:${client.mode}:${market.id}`;
  const hit = cacheGet<PromoterRoom[]>(key);
  if (hit) return hit;
  const raw = await client.insights({ "filter.type": "urn:entity:place", "filter.location": wktOf(market), "filter.location.radius": VENUE_RADIUS_M, "filter.tags": VENUE_TAGS.join(","), take: VENUE_FETCH });
  const seen = new Set<string>();
  const rooms = raw.map((r) => normalize(r, "urn:entity:place"))
    .filter((e) => isShowRoom(e.place?.category) && !seen.has(e.id) && seen.add(e.id))
    .slice(0, ROOMS_SHOWN)
    .map((e) => ({ id: e.id, name: e.name, tier: tierOf(e.place?.category), address: e.place?.address, neighborhood: e.place?.neighborhood }));
  cacheSet(key, rooms, TTL_MS);
  return rooms;
}

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

  if (!spend(mode, deps.now ?? Date.now())) return { status: 429, body: { city: market.name, acts: [], mode, error: BUSY } };

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
    // City extras: soft, so a failure here never costs the act list.
    const tasteSignal = signal.kind === "locality" ? { "signal.location.query": place } : { "signal.location": signal.wkt };
    const [rooms, taste] = await Promise.all([
      roomsFor(client, market).catch(() => [] as PromoterRoom[]),
      client.tagInsights({ ...tasteSignal, "filter.tag.types": MUSIC_GENRE, take: 10 }).then((t) => tasteLine(t), () => [] as string[]),
    ]);
    const body: PromoterResponse = { city: market.name, genre, signal, acts: toActs(entities), rooms, taste, mode };
    cacheSet(key, body, TTL_MS);
    return { status: 200, body };
  } catch (e) {
    const msg = isProviderError(e) ? e.userMessage : "Qloo is unavailable right now.";
    return { status: 502, body: { city: market.name, acts: [], mode, error: msg } };
  }
}

/** "Who fits this room": artists ranked by Qloo with one of the city's rooms as the taste signal, music acts only. */
export async function actsForRoom(rawCity: string | null, rawVenue: string | null, deps: { qloo?: QlooClient; now?: number } = {}): Promise<{ status: number; body: RoomActsResponse }> {
  const market = rawCity && rawCity.length <= 80 ? findMarket(rawCity) : undefined;
  const client = deps.qloo ?? createQlooClient();
  const mode = client.mode;
  if (!market) return { status: 400, body: { city: rawCity ?? "", acts: [], mode, error: "Pick a city from the touring-city list." } };
  const venue = rawVenue?.trim() ?? "";
  if (!VENUE_ID.test(venue)) return { status: 400, body: { city: market.name, acts: [], mode, error: "Pick a room from the list." } };

  const key = `promoter-room:${mode}:${market.id}:${venue}`;
  const hit = cacheGet<RoomActsResponse>(key);
  if (hit) return { status: 200, body: hit };
  if (!spend(mode, deps.now ?? Date.now())) return { status: 429, body: { city: market.name, acts: [], mode, error: BUSY } };
  try {
    // Only the city's own rooms (cached by the city lookup) can be the signal.
    const room = (await roomsFor(client, market)).find((r) => r.id === venue);
    if (!room) return { status: 400, body: { city: market.name, acts: [], mode, error: "Pick a room from the list." } };
    const raw = await client.insights({ "filter.type": "urn:entity:artist", "signal.interests.entities": room.id, "signal.location": wktOf(market), take: PROMOTER_FETCH });
    const music = raw.filter((r) => isMusicAct(r.tags));
    const body: RoomActsResponse = { city: market.name, room, acts: toActs(music).map((a) => ({ ...a, scoreLine: a.scoreLine.replace("for this city", "for this room") })), dropped: raw.length - music.length || undefined, mode };
    cacheSet(key, body, TTL_MS);
    return { status: 200, body };
  } catch (e) {
    const msg = isProviderError(e) ? e.userMessage : "Qloo is unavailable right now.";
    return { status: 502, body: { city: market.name, acts: [], mode, error: msg } };
  }
}
