/** Geometry helpers: distances, corridor polygons (as WKT for Qloo's filter.location) and point-in-polygon. */
export interface LatLon { lat: number; lon: number }
const R_MI = 3958.8;
const toR = (d: number) => (d * Math.PI) / 180;

/** Great-circle (straight-line) miles. Used for geometry rules (radius clause, spacing, direction), never for drive distance: see road.ts. */
export function gcMi(a: LatLon, b: LatLon): number {
  const dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_MI * Math.asin(Math.sqrt(h));
}

/**
 * A corridor polygon around the A->B leg: a rectangle along the segment, buffered `bufferMi` on every side.
 * Returned as a lon/lat ring and as WKT (Qloo expects `POLYGON((lon lat, ...))`).
 */
export function corridor(a: LatLon, b: LatLon, bufferMi: number): { ring: LatLon[]; wkt: string } {
  const midLat = toR((a.lat + b.lat) / 2);
  const kx = 69.17 * Math.cos(midLat), ky = 69.0; // miles per degree
  const ax = a.lon * kx, ay = a.lat * ky, bx = b.lon * kx, by = b.lat * ky;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len, uy = (by - ay) / len; // along
  const px = -uy, py = ux; // perpendicular
  const pts: [number, number][] = [
    [ax - ux * bufferMi + px * bufferMi, ay - uy * bufferMi + py * bufferMi],
    [bx + ux * bufferMi + px * bufferMi, by + uy * bufferMi + py * bufferMi],
    [bx + ux * bufferMi - px * bufferMi, by + uy * bufferMi - py * bufferMi],
    [ax - ux * bufferMi - px * bufferMi, ay - uy * bufferMi - py * bufferMi],
  ];
  const ring = pts.map(([x, y]) => ({ lat: round(y / ky), lon: round(x / kx) }));
  return { ring, wkt: ringToWkt(ring) };
}

/** WKT POLYGON for a ring (closes it). Qloo expects lon-lat order. */
export function ringToWkt(ring: LatLon[]): string {
  const closed = ring.length ? [...ring, ring[0]!] : [];
  return `POLYGON((${closed.map((p) => `${p.lon} ${p.lat}`).join(", ")}))`;
}

/** Lower-48 territory polygon (for nationwide fan-geography reads). */
export const LOWER48_RING: LatLon[] = [
  { lat: 24.5, lon: -125 }, { lat: 49.5, lon: -125 }, { lat: 49.5, lon: -66.5 }, { lat: 24.5, lon: -66.5 },
];
export const LOWER48_WKT = ringToWkt(LOWER48_RING); // POLYGON((-125 24.5, -125 49.5, -66.5 49.5, -66.5 24.5, -125 24.5))

/** Even-odd ray casting (planar lon/lat; fine for corridor-sized polygons away from the antimeridian). */
export function inRing(p: LatLon, ring: LatLon[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

/** Parse the outer ring of a WKT POLYGON ("lon lat" pairs). Returns null for anything malformed or non-numeric. */
export function parseWktPolygon(wkt: string): LatLon[] | null {
  const m = /POLYGON\s*\(\(([^)]+)\)\)/i.exec(wkt);
  if (!m?.[1]) return null;
  const ring: LatLon[] = [];
  for (const pair of m[1].split(",")) {
    const [lon, lat, ...rest] = pair.trim().split(/\s+/).map(Number);
    if (lon === undefined || lat === undefined || rest.length || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    ring.push({ lat, lon });
  }
  return ring.length >= 3 ? ring : null;
}

const round = (n: number) => Math.round(n * 10000) / 10000;
