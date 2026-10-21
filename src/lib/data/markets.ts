/**
 * Routed's market universe, built offline by scripts/data/build_markets.py from U.S. Census Bureau files (OMB metro
 * delineation, Vintage 2025 population estimates, 2025 Gazetteer) and OpenStreetMap venue counts. See docs/SOURCES.md.
 * Client-safe (the form's city picker uses it). The road matrix is separate and server-only (route/road.ts).
 */
import raw from "./markets.json";

export interface VenueCounts { total: number; music_venue: number; nightclub: number; theatre: number; live_music: number }
export interface Market {
  /** Stable id, e.g. "portland-or". */
  id: string;
  /** Display name, unique within the universe: the city name, plus ", ST" only when another market shares it. */
  name: string;
  /** City name as published by the Census Bureau (e.g. "Nashville-Davidson"). */
  censusName: string;
  state: string;
  /** City centre: the OpenStreetMap place node of the same name, else the Census Gazetteer internal point. */
  lat: number; lon: number;
  /** Where lat/lon came from: "osm:node/<id>" or "census:internal-point". */
  point?: string;
  /** Vintage 2025 resident population estimate (incorporated place). */
  population: number;
  /** Census GEOID (state + place FIPS). */
  geoid: string;
  /** Metropolitan Statistical Area (OMB July 2023) and its Vintage 2025 population estimate. */
  metro: { cbsa: string; title: string; population: number };
  /** OpenStreetMap-mapped live-performance venues within `MARKETS_META.venueRadiusMi` of the city centre. */
  venues: VenueCounts;
}
export interface MarketsMeta { built: string; rule: string; sources: Record<string, string>; venueRadiusMi: number; venuePointsUS?: number }

type RawCity = Omit<Market, "name" | "censusName"> & { name: string; censusName: string };
const rawCities = (raw as unknown as { meta: MarketsMeta; cities: RawCity[] }).cities;
const dup = new Map<string, number>();
for (const c of rawCities) dup.set(c.name, (dup.get(c.name) ?? 0) + 1);

export const MARKETS_META: MarketsMeta = (raw as unknown as { meta: MarketsMeta }).meta;
export const MARKETS: readonly Market[] = rawCities.map((c) => ({ ...c, name: (dup.get(c.name) ?? 0) > 1 ? `${c.name}, ${c.state}` : c.name }));
const byId = new Map(MARKETS.map((m) => [m.id, m]));
export const marketById = (id: string | undefined): Market | undefined => (id ? byId.get(id) : undefined);

const norm = (s: string) => s.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");
const byName = new Map(MARKETS.map((m) => [norm(m.name), m]));

/**
 * Look up a market by display name ("Portland, OR"), "City ST", id ("portland-or"), or a bare city name. A bare name
 * that several markets share ("Portland") resolves to the one with the largest metro population, which is what a
 * booking agent usually means; pass the state to be explicit.
 */
export function findMarket(input: string): Market | undefined {
  const q = norm(input);
  if (!q) return undefined;
  const hit = byName.get(q) ?? byId.get(q.replace(/,/g, "").replace(/ /g, "-"));
  if (hit) return hit;
  const m = /^(.+?)[, ]+([a-z]{2})$/.exec(q);
  if (m?.[1] && m[2]) {
    const st = m[2].toUpperCase();
    const x = MARKETS.find((c) => c.state === st && norm(c.censusName) === m[1] || c.state === st && norm(c.name.replace(/, [A-Z]{2}$/, "")) === m[1]);
    if (x) return x;
  }
  const same = MARKETS.filter((c) => norm(c.name.replace(/, [A-Z]{2}$/, "")) === q || norm(c.censusName) === q);
  return same.sort((a, b) => b.metro.population - a.metro.population)[0];
}

/** OpenStreetMap link centred on the market (for "check the venues yourself"). */
export const osmUrl = (m: Pick<Market, "lat" | "lon">) => `https://www.openstreetmap.org/#map=12/${m.lat.toFixed(4)}/${m.lon.toFixed(4)}`;
/** Census QuickFacts page for the place (population source). */
export const censusUrl = (m: Pick<Market, "geoid">) => `https://data.census.gov/profile?g=160XX00US${m.geoid}`;
