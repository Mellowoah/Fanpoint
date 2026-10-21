/**
 * Venue helpers shared by the server (agent, promoter API) and the browser. Pure functions, no I/O.
 *
 * Verified live on hackathon.api.qloo.com (2026-10-21, notes in docs-live/QLOO_DATA_OPTIONS.md, not in the repo):
 *   - `urn:entity:place` results carry address, website, phone, `primary_genre` (the venue's category) and free-text
 *     descriptions; `signal.interests.entities=<artist>` adds a per-venue `query.affinity`.
 *   - Qloo has NO capacity field. A number shows up only when a description states one (a few venues).
 *   - `filter.location.query="Camden, NJ"` resolves to Camden County, so a fuzzy city name can widen the area.
 *     Fanpoint therefore sends the market centre as a WKT POINT plus a fixed radius (`filter.location.radius`,
 *     metres), which also verified live; rooms across a city line (Camden -> Philadelphia) are then labelled with
 *     their own city and their distance from the stop.
 */
import { gcMi } from "../route/geo";

/** Place category tags for rooms that host concerts (verified tag ids, /v2/tags). Union: a room needs one of them. */
export const VENUE_TAGS = ["urn:tag:category:place:live_music_venue", "urn:tag:category:place:concert_hall", "urn:tag:category:place:amphitheater"] as const;
/** Search radius around the market centre for rooms and fan neighborhoods (metres; ~10 mi). */
export const VENUE_RADIUS_M = 16_000;
/** Rooms are requested in this batch, then filtered to the category whitelist below. */
export const VENUE_FETCH = 15;

export type VenueTier = "club" | "venue" | "theatre" | "arena";
/**
 * Category whitelist (the last segment of Qloo's `properties.primary_genre.id`) -> size tier. A tier is Fanpoint's own
 * heuristic from the category, NOT a capacity: Qloo files a 250-cap club and a 2,500-cap hall both as
 * `live_music_venue`. Anything off this list (museums, wedding venues, restaurants, theatre companies...) is dropped.
 */
export const VENUE_CATEGORIES: Readonly<Record<string, VenueTier>> = {
  bar: "club", live_music_bar: "club", night_club: "club", jazz_club: "club",
  live_music_venue: "venue", music_venue: "venue",
  performing_arts_theater: "theatre", concert_hall: "theatre",
  amphitheater: "arena", arena: "arena", stadium: "arena",
};
export const TIER_LABEL: Readonly<Record<VenueTier, string>> = {
  club: "Club / bar room", venue: "Music venue (size varies)", theatre: "Theatre / concert hall", arena: "Amphitheatre / arena",
};
export const TIER_NOTE = "Size tier from the venue's Qloo category (Fanpoint's heuristic, not a capacity). Qloo has no capacity field.";

/** Venue facts Fanpoint keeps from a Qloo place record (everything optional: Qloo fills them unevenly). */
export interface PlaceInfo {
  address?: string; website?: string; phone?: string; neighborhood?: string;
  /** Last segment of primary_genre.id, e.g. "live_music_venue"; `categoryName` is Qloo's label. */
  category?: string; categoryName?: string;
  /** Only when a Qloo description states it ("1,016-seat auditorium"); `capacityQuote` is the matching text. */
  capacity?: number; capacityQuote?: string;
}

export const categoryOf = (primaryGenreId?: string) => primaryGenreId?.split(":").pop()?.toLowerCase();
export const tierOf = (category?: string): VenueTier | undefined => (category ? VENUE_CATEGORIES[category] : undefined);
/** On the whitelist = a room that hosts shows. */
export const isShowRoom = (category?: string) => tierOf(category) !== undefined;

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d{2,6})`;
const CAPACITY = [
  new RegExp(String.raw`\b${NUM}[- ](?:seats?|seater|seat(?:ed|ing)|person|people|capacity)\b`, "i"),
  new RegExp(String.raw`\bcapacity (?:of |for )?(?:up to |about |around |over |nearly |roughly )?${NUM}\b`, "i"),
];
/** A capacity a description actually states, with the words around it. Out-of-range numbers are ignored. */
export function statedCapacity(texts: (string | undefined)[]): { capacity: number; quote: string } | undefined {
  for (const t of texts) {
    if (!t) continue;
    for (const re of CAPACITY) {
      const m = re.exec(t);
      if (!m) continue;
      const n = Number(m[1]!.replace(/,/g, ""));
      if (n < 20 || n > 120_000) continue;
      // About 30 characters either side, widened to whole words.
      let from = Math.max(0, m.index - 30), to = Math.min(t.length, m.index + m[0].length + 30);
      while (from > 0 && /\S/.test(t[from - 1]!)) from--;
      while (to < t.length && /\S/.test(t[to]!)) to++;
      return { capacity: n, quote: `${from > 0 ? "…" : ""}${t.slice(from, to).trim()}${to < t.length ? "…" : ""}` };
    }
  }
  return undefined;
}

/** Only http(s) links reach the UI. */
export const safeUrl = (u?: string) => (u && /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : undefined);

/** One fan neighborhood: a Qloo locality below city level, from the locality heatmap. */
export interface FanHood { id: string; name: string; /** Parent area from Qloo: a district or the city. */ city?: string; affinity: number; lat?: number; lon?: number }
/** Neighborhoods kept per city. */
export const HOODS_SHOWN = 3;
/** A venue this close to a top neighborhood's centre counts as "in or next to" it. */
export const HOOD_NEAR_MI = 1;

const key = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/**
 * Which top fan neighborhood (if any) explains a venue: Qloo's own neighborhood name for the venue first, otherwise
 * the closest top neighborhood within HOOD_NEAR_MI of the venue.
 */
export function hoodForVenue(v: { lat?: number; lon?: number; place?: PlaceInfo }, hoods: FanHood[]): { hood: FanHood; how: "named" | "near"; mi?: number } | undefined {
  const named = v.place?.neighborhood ? hoods.find((h) => key(h.name) === key(v.place!.neighborhood!)) : undefined;
  if (named) return { hood: named, how: "named" };
  if (v.lat === undefined || v.lon === undefined) return undefined;
  let best: { hood: FanHood; mi: number } | undefined;
  for (const h of hoods) {
    if (h.lat === undefined || h.lon === undefined) continue;
    const mi = gcMi({ lat: v.lat, lon: v.lon }, { lat: h.lat, lon: h.lon });
    if (mi <= HOOD_NEAR_MI && (!best || mi < best.mi)) best = { hood: h, mi };
  }
  return best ? { hood: best.hood, how: "near", mi: Math.round(best.mi * 10) / 10 } : undefined;
}
