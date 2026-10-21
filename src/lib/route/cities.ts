/**
 * Touring markets: the Census-derived market universe (data/markets.ts) with a `region` (state) field for display.
 * Used to read Qloo heatmap cells at named cities, place anchors on the map, map plain-AI answers onto the map,
 * and key the road matrix. Client-safe.
 */
import { findMarket, MARKETS, type Market } from "../data/markets";

export type TouringCity = Market & { region: string };
export const US_CITIES: readonly TouringCity[] = MARKETS.map((m) => ({ ...m, region: m.state }));
const byId = new Map(US_CITIES.map((c) => [c.id, c]));

/** Resolve a user- or model-supplied city name (see findMarket for the accepted forms). */
export function findCity(name: string): TouringCity | undefined {
  const m = findMarket(name);
  return m ? byId.get(m.id) : undefined;
}
