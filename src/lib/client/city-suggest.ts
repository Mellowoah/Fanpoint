/** City autocomplete over Routed's own market list (no external source). Client-safe. */
import { MARKETS, type Market } from "../data/markets";

/** "Durham, NC": the market name plus its state, unless the name already carries one. */
export const cityLabel = (m: Pick<Market, "name" | "state">) => (m.name.includes(",") ? m.name : `${m.name}, ${m.state}`);
const norm = (s: string) => s.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");

/**
 * Up to `take` markets for a typed prefix: name prefix first, then a word inside the name, then the state code or
 * the Census name; ties go to the larger metro. Empty input lists the biggest markets.
 */
export function suggestCities(input: string, take = 8): Market[] {
  const q = norm(input).replace(/,\s*$/, "");
  const score = (m: Market): number => {
    if (!q) return 3;
    const label = norm(cityLabel(m)), name = norm(m.name);
    if (label === q || name === q) return 0;
    if (name.startsWith(q) || label.startsWith(q)) return 1;
    if (name.split(/[\s-]+/).some((w) => w.startsWith(q))) return 2;
    if (norm(m.censusName).includes(q) || label.includes(q) || norm(m.state) === q) return 3;
    return 9;
  };
  return MARKETS.map((m) => ({ m, s: score(m) }))
    .filter((x) => x.s < 9)
    .sort((a, b) => a.s - b.s || b.m.metro.population - a.m.metro.population)
    .slice(0, take)
    .map((x) => x.m);
}
