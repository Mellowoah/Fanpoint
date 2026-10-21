/**
 * Real road distances and drive times between every pair of Routed markets, precomputed once with OSRM (car
 * profile) on OpenStreetMap data by scripts/data/build_markets.py and committed as road-matrix.json. No routing
 * service is called at runtime (the public OSRM demo server is for light, non-commercial use only).
 * See docs/SOURCES.md for licenses and for self-hosting OSRM to refresh or extend the matrix.
 */
import raw from "../data/road-matrix.json";
import type { LatLon } from "./geo";

export interface Leg { mi: number; hours: number }
/** A place the router can resolve: Routed markets carry an `id`. */
export type RoutePoint = LatLon & { id?: string };
/** Road leg between two points, or undefined when there is no known route. */
export type RoadFn = (a: RoutePoint, b: RoutePoint) => Leg | undefined;

export interface RoadMatrixMeta { built: string; engine: string; data: string; units: string; order: string }
interface RawMatrix { meta: RoadMatrixMeta; ids: string[]; miles: string; minutes: string }

export const NO_ROUTE = 65535;

/** Decode a little-endian uint16 matrix from base64 (works in Node and browsers). */
export function decodeU16(b64: string): Uint16Array {
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  const out = new Uint16Array(bin.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
  return out;
}

export interface RoadMatrix { meta: RoadMatrixMeta; ids: readonly string[]; leg: RoadFn; legById(a: string, b: string): Leg | undefined }

export function buildRoadMatrix(m: RawMatrix): RoadMatrix {
  const n = m.ids.length;
  const miles = decodeU16(m.miles), minutes = decodeU16(m.minutes);
  if (miles.length !== n * n || minutes.length !== n * n) throw new Error(`road matrix: expected ${n * n} cells, got ${miles.length}/${minutes.length}`);
  const index = new Map(m.ids.map((id, i) => [id, i]));
  const legById = (a: string, b: string): Leg | undefined => {
    const i = index.get(a), j = index.get(b);
    if (i === undefined || j === undefined) return undefined;
    if (i === j) return { mi: 0, hours: 0 };
    const mi = miles[i * n + j]!, min = minutes[i * n + j]!;
    return mi === NO_ROUTE || min === NO_ROUTE ? undefined : { mi, hours: Math.round((min / 60) * 10) / 10 };
  };
  return { meta: m.meta, ids: m.ids, legById, leg: (a, b) => (a.id && b.id ? legById(a.id, b.id) : undefined) };
}

let cached: RoadMatrix | undefined;
/** The committed OSRM matrix (decoded once per process). */
export function osrmRoads(): RoadMatrix {
  return (cached ??= buildRoadMatrix(raw as RawMatrix));
}
