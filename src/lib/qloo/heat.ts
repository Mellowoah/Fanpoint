import type { HeatCell } from "./types";
import { gcMi, inRing, type LatLon } from "../route/geo";
import type { TouringCity } from "../route/cities";
import { RULE_VALUES } from "../touring/rules";

export interface CityHeat { id: string; name: string; region: string; lat: number; lon: number; affinity: number; popularity?: number; cellDistMi: number }

/**
 * Read Qloo heatmap cells at named touring cities: a city takes the strongest cell within `radiusMi` of its centre
 * (metro peak). Cities with no cell in range are skipped, not guessed.
 */
export function readCities(cells: HeatCell[], cities: readonly TouringCity[], radiusMi: number = RULE_VALUES.metroReadRadiusMi, ring?: LatLon[]): CityHeat[] {
  const out: CityHeat[] = [];
  // Cheap bounding-box pre-filter before the great-circle check, sized from the radius
  // (a fixed box used to silently cut off radii above ~36 mi at northern latitudes).
  const dLat = radiusMi / 68.7 + 0.01;
  for (const c of cities) {
    if (ring && !inRing(c, ring)) continue;
    const dLon = radiusMi / (69.17 * Math.max(0.1, Math.cos((c.lat * Math.PI) / 180))) + 0.01;
    let best: HeatCell | undefined, bestD = 0;
    for (const cell of cells) {
      if (Math.abs(cell.lat - c.lat) > dLat || Math.abs(cell.lon - c.lon) > dLon) continue;
      const d = gcMi(c, cell);
      if (d <= radiusMi && (!best || cell.affinity > best.affinity)) { best = cell; bestD = d; }
    }
    if (best) out.push({ id: c.id, name: c.name, region: c.region, lat: c.lat, lon: c.lon, affinity: best.affinity, popularity: best.popularity, cellDistMi: Math.round(bestD) });
  }
  return out.sort((a, b) => b.affinity - a.affinity);
}

/** Downsample cells for the browser: keep at most `max`, strongest first. */
export function packCells(cells: HeatCell[], max = 500): [number, number, number][] {
  return [...cells].sort((a, b) => b.affinity - a.affinity).slice(0, max).map((c) => [c.lat, c.lon, c.affinity]);
}
