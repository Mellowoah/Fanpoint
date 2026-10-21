/**
 * MOCK fan geography (NOT Qloo data). Hand-made "fan profiles" for the fictional demo artists, so the offline demo
 * has a coherent geographic story. Each profile is a set of city bumps; a grid cell's mock affinity is the strongest
 * bump at that point (Gaussian fall-off) over a low noisy base. Unknown artists get a hashed profile.
 */
import { US_CITIES, findCity } from "../../route/cities";
import { gcMi } from "../../route/geo";

export const MOCK_PROFILES: Record<string, Record<string, number>> = {
  // Fictional dream-pop act: strongest in the Mid-Atlantic / Southeast college towns; weak Midwest & West.
  "mock-artist-marigold-static": {
    Asheville: 0.97, Richmond: 0.93, Athens: 0.92, Philadelphia: 0.9, Charlottesville: 0.89, Durham: 0.88, Baltimore: 0.85,
    Greenville: 0.82, Norfolk: 0.74, "New York": 0.8, Knoxville: 0.74, Greensboro: 0.72,
    Lancaster: 0.71, Chattanooga: 0.7, Nashville: 0.7, Atlanta: 0.72, Washington: 0.66, Charlotte: 0.64, Wilmington: 0.63,
    Columbia: 0.61, Providence: 0.66, Boston: 0.6, Pittsburgh: 0.62, Louisville: 0.6,
  },
  // Most taste-similar peer, but the SAME geography (a redundant co-headline).
  "mock-artist-low-tide-choir-mock": {
    Asheville: 0.95, Richmond: 0.9, Athens: 0.9, Philadelphia: 0.88, Durham: 0.9, Charlottesville: 0.84, Baltimore: 0.82,
    Greenville: 0.8, "New York": 0.78, Knoxville: 0.76, Atlanta: 0.74, Nashville: 0.72, Chattanooga: 0.74,
  },
  // Complementary: Great Lakes / Midwest.
  "mock-artist-saltwater-hymnal-mock": {
    Chicago: 0.95, Madison: 0.93, Minneapolis: 0.92, Milwaukee: 0.9, "Ann Arbor": 0.9, Detroit: 0.86, "Columbus, OH": 0.85,
    Cleveland: 0.82, Pittsburgh: 0.8, Indianapolis: 0.8, Lansing: 0.84, "St. Louis": 0.76, "Grand Rapids": 0.83,
    Philadelphia: 0.72, "New York": 0.74, Richmond: 0.62,
  },
  // Complementary: New England / upstate NY.
  "mock-artist-pale-fiction-mock": {
    Boston: 0.95, Burlington: 0.94, Springfield: 0.93, "Portland, ME": 0.9, Providence: 0.89, Albany: 0.84, Syracuse: 0.88,
    Worcester: 0.86, "New Haven": 0.84, "New York": 0.86, Philadelphia: 0.74, Rochester: 0.76,
  },
  // Texas / Gulf South.
  "mock-artist-moth-radio-mock": {
    Austin: 0.96, Dallas: 0.88, Houston: 0.86, "San Antonio": 0.84, "New Orleans": 0.9, Memphis: 0.82, "Oklahoma City": 0.78,
    Birmingham: 0.74, Nashville: 0.8, Athens: 0.72,
  },
  // West / Mountain.
  "mock-artist-velvet-orchard-mock": {
    Portland: 0.96, Seattle: 0.94, Eugene: 0.9, "San Francisco": 0.9, Sacramento: 0.82, "Los Angeles": 0.84, Denver: 0.88,
    Boulder: 0.9, "Salt Lake City": 0.84, Bend: 0.88, Boise: 0.82, Spokane: 0.8, Albuquerque: 0.8, Tucson: 0.76,
  },
};

/** Taste similarity of peers to the demo artist (mock). Low Tide Choir is the most similar on purpose. */
export const MOCK_SIMILARITY: Record<string, number> = {
  "mock-artist-low-tide-choir-mock": 0.972, "mock-artist-fernhill-static-mock": 0.951, "mock-artist-pale-fiction-mock": 0.934,
  "mock-artist-saltwater-hymnal-mock": 0.917, "mock-artist-moth-radio-mock": 0.889, "mock-artist-velvet-orchard-mock": 0.871,
  "mock-artist-june-arcade-mock": 0.86, "mock-artist-copperline-mock": 0.842,
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

type Bump = { lat: number; lon: number; v: number };
const cache = new Map<string, Bump[]>();
function bumps(artistId: string): Bump[] {
  const hit = cache.get(artistId);
  if (hit) return hit;
  let prof = MOCK_PROFILES[artistId];
  if (!prof) {
    // Hashed profile for any other (synthesized) mock artist: 6 random strong cities.
    prof = {};
    const picks = [...US_CITIES].sort((a, b) => hash(artistId + a.name) - hash(artistId + b.name)).slice(0, 6);
    picks.forEach((c, i) => { prof![c.name] = 0.95 - i * 0.04; });
  }
  const out = Object.entries(prof).flatMap(([name, v]) => { const c = findCity(name); return c ? [{ lat: c.lat, lon: c.lon, v }] : []; });
  cache.set(artistId, out);
  return out;
}

/** Mock affinity (0..1) of an artist's audience at a point. sigmaMi controls how far a city's fan base "spills". */
export function mockAffinityAt(artistId: string, lat: number, lon: number, sigmaMi = 45): number {
  const base = 0.18 + 0.22 * hash(`${artistId}:${lat.toFixed(2)}:${lon.toFixed(2)}`);
  let best = base;
  for (const b of bumps(artistId)) {
    const d = gcMi({ lat, lon }, b);
    if (d > sigmaMi * 3) continue;
    best = Math.max(best, b.v * Math.exp(-((d / sigmaMi) ** 2)));
  }
  return Math.min(0.995, Math.round(best * 1000) / 1000);
}
