/**
 * With Qloo / Without Qloo ranked gap-city lists: the proof that Qloo affinity, not the rest of the pipeline, decides
 * which cities Routed recommends.
 *
 * 1. Candidate set (identical in both modes, no Qloo data): every market in the anchor-to-anchor corridor polygon that
 *    passes the existing hard filters: market universe (Census metro population floor, built offline), anchors and
 *    radius clause, "between the anchors" (no backtracking), at least one OSM-mapped venue, a known OSRM road route, and the OSRM drive limits (miles
 *    AND hours per day) for at least one off day: A -> city in d days and city -> B in the days left. The Qloo heat
 *    floor is NOT applied here, because it needs affinity.
 * 2. With Qloo (default): Qloo location-specific affinity for the artist (the corridor heatmap read), descending.
 *    Ties: the heat cell's Qloo popularity, then market id. Cities with no Qloo reading go last.
 * 3. Without Qloo (fixed proxy, chosen before looking at results and not tuned): Census Vintage 2025 city population,
 *    descending; ties: OpenStreetMap venue count within 10 mi, descending; then market id. No affinity data at all.
 * Pure and client-safe; the server attaches the result to the plan (agent/run.ts buildFill).
 */
import { fits, screen, daysBetween, DEFAULT_PARAMS, type Anchor, type FillParams } from "./fill";
import { inRing, type LatLon } from "./geo";
import type { RoadFn } from "./road";
import type { TouringCity } from "./cities";

export type RankMode = "with" | "without";
export interface RankedCity {
  id: string; name: string; region: string; lat: number; lon: number;
  /** Census Vintage 2025 city population and OSM venue count (the Without Qloo proxy). */
  population: number; venues: number;
  /** Qloo affinity for this artist at this city (corridor heatmap read); undefined = no Qloo reading. */
  affinity?: number; popularity?: number;
  /** OSRM road legs from anchor A and on to anchor B (miles and hours, rounded). */
  fromA?: { mi: number; hours: number }; toB?: { mi: number; hours: number };
}
export interface RankedGap {
  from: string; to: string; offDays: number;
  /** Cities in the corridor polygon before the hard filters, and after them (= length of both lists). */
  inCorridor: number; eligible: number;
  note?: string;
  /** Corridor cities removed by the hard filters, with the reason (identical for both modes). */
  dropped: { id: string; name: string; reason: string }[];
  withQloo: RankedCity[]; withoutQloo: RankedCity[];
}
export interface HeatRead { affinity: number; popularity?: number }

/** The Without Qloo proxy, fixed up front. Exported so tests and docs pin it. */
export const PROXY_DESCRIPTION = "Census 2025 city population (desc), tie-break OpenStreetMap venues within 10 mi (desc)";

export const byQloo = (a: RankedCity, b: RankedCity) =>
  (a.affinity === undefined ? 1 : 0) - (b.affinity === undefined ? 1 : 0)
  || (b.affinity ?? 0) - (a.affinity ?? 0)
  || (b.popularity ?? -1) - (a.popularity ?? -1)
  || a.id.localeCompare(b.id);
export const byProxy = (a: RankedCity, b: RankedCity) => b.population - a.population || b.venues - a.venues || a.id.localeCompare(b.id);

/**
 * Hard filters only (no Qloo). Returns the eligible cities for the gap A -> B, or a note when the gap itself is
 * infeasible. `used` holds lower-cased names that can never be fills (the anchors).
 */
export function eligibleCities(A: Anchor, B: Anchor, ring: LatLon[], cities: readonly TouringCity[], params: FillParams, road: RoadFn, used: Set<string>): { inCorridor: number; list: TouringCity[]; dropped: { id: string; name: string; reason: string }[]; note?: string } {
  const p = { ...DEFAULT_PARAMS, ...params };
  const span = daysBetween(A.date, B.date);
  const inside = cities.filter((c) => inRing(c, ring));
  const all = (reason: string) => inside.map((c) => ({ id: c.id, name: c.name, reason }));
  if (span < 2) return { inCorridor: inside.length, list: [], dropped: all("no off days"), note: "No off days between these anchors." };
  const direct = road(A, B);
  if (!direct || !fits(direct, span, p)) return { inCorridor: inside.length, list: [], dropped: all("anchors break the drive limits"), note: `${A.city} to ${B.city} breaks the drive limits on its own.` };
  const dropped: { id: string; name: string; reason: string }[] = [];
  const list = inside.filter((c) => {
    // affinity 1 is a placeholder: screen() with heatFloor=false never reads it.
    const s = screen({ ...c, affinity: 1 }, A, B, p, used, road, false);
    if (s) { dropped.push({ id: c.id, name: c.name, reason: s.detail ? `${s.status}: ${s.detail}` : s.status }); return false; }
    const toC = road(A, c)!, toB = road(c, B)!; // screen() already required both road legs
    for (let d = 1; d < span; d++) if (fits(toC, d, p) && fits(toB, span - d, p)) return true;
    dropped.push({ id: c.id, name: c.name, reason: "drive limits (no off day fits)" });
    return false;
  });
  return { inCorridor: inside.length, list, dropped };
}

/** Both ranked lists for every gap. `heat[k]` maps city id -> Qloo read for gap k (empty map = no Qloo data). */
export function rankGaps(anchors: Anchor[], rings: LatLon[][], heat: Map<string, HeatRead>[], cities: readonly TouringCity[], params: FillParams, road: RoadFn): RankedGap[] {
  const sorted = [...anchors].sort((a, b) => a.date.localeCompare(b.date));
  const used = new Set(sorted.map((a) => a.city.toLowerCase()));
  return sorted.slice(0, -1).map((A, k) => {
    const B = sorted[k + 1]!;
    const { inCorridor, list, dropped, note } = eligibleCities(A, B, rings[k] ?? [], cities, params, road, used);
    const h = heat[k] ?? new Map<string, HeatRead>();
    const leg = (l: { mi: number; hours: number } | undefined) => (l ? { mi: Math.round(l.mi), hours: Math.round(l.hours * 10) / 10 } : undefined);
    const rows: RankedCity[] = list.map((c) => ({
      id: c.id, name: c.name, region: c.region, lat: c.lat, lon: c.lon, population: c.population, venues: c.venues.total,
      fromA: leg(road(A, c)), toB: leg(road(c, B)),
      affinity: h.get(c.id)?.affinity, popularity: h.get(c.id)?.popularity,
    }));
    return {
      from: A.city, to: B.city, offDays: Math.max(0, daysBetween(A.date, B.date) - 1), inCorridor, eligible: rows.length, note, dropped,
      withQloo: [...rows].sort(byQloo),
      // The proxy never sees affinity: strip it so the Without Qloo list cannot leak the signal into the UI.
      withoutQloo: rows.map(({ affinity: _a, popularity: _p, ...r }) => r).sort(byProxy),
    };
  });
}
