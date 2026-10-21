/**
 * MOCK Qloo adapter. Returns Qloo-shaped responses synthesized from ./fixtures/mock-qloo.json.
 * Every entity carries `_mock: true` and fictional "(mock)" names. NOT real Qloo data.
 * It consumes the exact same request params as the live client, so the agent code path is identical.
 */
import fixtures from "./fixtures/mock-qloo.json";
import { responseHash } from "./hash";
import { cleanParams, type HeatCell, type LocalInsights, type QlooCallLog, type QlooClient, type QlooParams, type QlooRawEntity } from "./types";
import { parseInsights, parseSearch } from "./schemas";
import { MOCK_SIMILARITY, mockAffinityAt } from "./fixtures/mock-geo";
import { US_CITIES, findCity } from "../route/cities";
import { gcMi, inRing, parseWktPolygon, type LatLon } from "../route/geo";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const round = (n: number) => Math.round(n * 1000) / 1000;

type Pool = { name: string; tags: string[] }[];

export class MockQlooClient implements QlooClient {
  readonly mode = "mock" as const;
  readonly calls: QlooCallLog[] = [];
  /** Simulated network latency range in ms ([0, 0] in tests). */
  constructor(private readonly latencyMs: [number, number] = [60, 180]) {}

  private log(endpoint: string, params: QlooParams, out: unknown[]) {
    this.calls.push({ endpoint, params: cleanParams(params), ms: 0, status: "mock", resultCount: out.length, responseHash: responseHash(JSON.stringify(out)) });
  }
  private tick() {
    const [lo, hi] = this.latencyMs;
    return hi > 0 ? new Promise((r) => setTimeout(r, lo + Math.random() * (hi - lo))) : Promise.resolve();
  }

  private artistById(id: string) {
    const known = fixtures.artists.find((a) => a.entity_id === id);
    if (known) return known;
    const name = id.replace(/^mock-artist-/, "").replace(/-/g, " ");
    return { entity_id: id, name, popularity: 0.5, description: "Synthesized mock artist (mock).", tags: ["Indie"], cityBias: {} as Record<string, number> };
  }

  async search(query: string, types: string[], take = 5): Promise<QlooRawEntity[]> {
    await this.tick();
    const q = query.trim().toLowerCase();
    let found: { entity_id: string; name: string; popularity: number; description: string; tags: string[]; cityBias: Record<string, number> }[] = fixtures.artists.filter((a) => a.name.toLowerCase().includes(q));
    if (found.length === 0 && q.length > 0) {
      // Any name works offline: synthesize a mock artist so the demo flow can run.
      found = [{ entity_id: `mock-artist-${slug(query)}`, name: query.trim(), popularity: 0.5, description: "Synthesized mock artist (mock).", tags: ["Indie"], cityBias: {} }];
    }
    const out = found.slice(0, take).map<QlooRawEntity>((a) => ({
      name: a.name, entity_id: a.entity_id, types: ["urn:entity:artist"], popularity: a.popularity,
      properties: { short_description: a.description }, tags: a.tags.map((t) => ({ name: t, type: "urn:tag:genre:music" })), _mock: true,
    }));
    this.log("/search", { query, types: types.join(","), take }, out);
    return parseSearch({ results: out }).items; // same validator as live responses
  }

  async tags(query: string, tagTypes?: string[]) {
    await this.tick();
    if (tagTypes?.includes("urn:tag:genre:music")) {
      // Fictional genre tags: match the mock co-bill pool's genre names (e.g. "dream" -> Dream Pop).
      const q = query.trim().toLowerCase();
      const names = [...new Set(fixtures.cobillPool.flatMap((x) => x.tags))].filter((t) => t.toLowerCase().includes(q)).sort((a, b) => Number(!a.toLowerCase().startsWith(q)) - Number(!b.toLowerCase().startsWith(q)));
      const out = names.slice(0, 10).map((t) => ({ id: `urn:tag:genre:music:${t.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, name: `${t} (mock)` }));
      this.log("/v2/tags", { "filter.query": query, "filter.tag.types": tagTypes.join(",") }, out);
      return out;
    }
    const out = [{ id: "urn:tag:category:place:music_venue", name: "Music Venue (mock tag id - verify live)" }];
    this.log("/v2/tags", { "filter.query": query, "filter.tag.types": tagTypes?.join(",") }, out);
    return out;
  }

  async insights(p: QlooParams): Promise<QlooRawEntity[]> {
    await this.tick();
    const type = String(p["filter.type"] ?? "");
    const signal = String(p["signal.interests.entities"] ?? "").split(",")[0] ?? "";
    const city = String(p["signal.location.query"] ?? p["filter.location.query"] ?? "");
    const take = Number(p.take ?? 10);
    const artist = this.artistById(signal);
    let out: QlooRawEntity[] = [];

    if (type === "urn:entity:destination") {
      const ring = parseWktPolygon(String(p["filter.location"] ?? ""));
      out = US_CITIES.filter((c) => !ring || inRing(c, ring))
        .map((c) => ({ c, a: mockAffinityAt(artist.entity_id, c.lat, c.lon) }))
        .sort((x, y) => y.a - x.a)
        .slice(0, take)
        .map(({ c, a }) => ({
          name: c.name, entity_id: `mock-dest-${slug(c.name)}`, subtype: "urn:entity:destination",
          location: { lat: c.lat, lon: c.lon }, popularity: round(0.4 + 0.5 * hash(c.name)),
          properties: { geocode: { name: c.name, admin1_region: c.region, country_code: "US" } },
          query: { affinity: round(a) },
          _mock: true,
        }));
    } else if (type === "urn:entity:artist") {
      const exclude = new Set(String(p["filter.exclude.entities"] ?? "").split(",").concat(signal));
      const point = /^POINT\((-?[\d.]+) (-?[\d.]+)\)$/.exec(String(p["signal.location"] ?? ""));
      const c = city ? findCity(city) : point ? { lat: Number(point[2]), lon: Number(point[1]) } : undefined;
      const tagFilter = new Set(String(p["filter.tags"] ?? "").split(",").filter(Boolean));
      const tagUrn = (t: string) => `urn:tag:genre:music:${t.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
      // No location: taste similarity. With a location: similarity blended with the peer's local mock fan heat.
      out = fixtures.cobillPool
        .map((x) => {
          const id = `mock-artist-${slug(x.name)}`;
          const sim = MOCK_SIMILARITY[id] ?? 0.7 + 0.2 * hash(signal + x.name);
          const a = c ? 0.5 * sim + 0.5 * mockAffinityAt(id, c.lat, c.lon) : sim;
          return { x, id, a };
        })
        .filter((r) => !exclude.has(r.id) && (!tagFilter.size || r.x.tags.some((t) => tagFilter.has(tagUrn(t)))))
        .sort((a, b) => b.a - a.a)
        .slice(0, take)
        .map(({ x, id, a }) => ({
          name: x.name, entity_id: id, subtype: "urn:entity:artist", popularity: round(0.5 + 0.2 * hash(x.name)),
          tags: x.tags.map((t) => ({ name: t })), query: { affinity: round(a) }, _mock: true,
        }));
    } else if (type === "urn:entity:place") {
      const c = findCity(city);
      out = this.pick(fixtures.venuePool, artist.entity_id + city, take, "urn:entity:place", "place").map((e, i) => ({
        ...e,
        name: e.name.replace(" (mock)", ` ${city} (mock)`),
        entity_id: `${e.entity_id}-${slug(city)}`,
        location: c ? { lat: c.lat + 0.01 * (i + 1), lon: c.lon - 0.01 * (i + 1) } : undefined,
        properties: { geocode: { name: city, admin1_region: c?.region, country_code: "US" } },
      }));
    } else if (type === "urn:entity:brand") {
      out = this.pick(fixtures.brandPool, artist.entity_id + city, take, "urn:entity:brand", "brand");
    } else if (type === "urn:entity:podcast") {
      out = this.pick(fixtures.podcastPool, artist.entity_id + city, take, "urn:entity:podcast", "podcast");
    } else if (type === "urn:entity:tv_show") {
      out = this.pick(fixtures.tvPool, artist.entity_id + city, take, "urn:entity:tv_show", "tv");
    }
    this.log("/v2/insights", p, out);
    return parseInsights({ results: { entities: out } }).items; // same validator as live responses
  }

  async insightsLocal(p: QlooParams): Promise<LocalInsights> {
    const entities = await this.insights(p);
    const c = p["signal.location.query"] ? findCity(String(p["signal.location.query"])) : undefined;
    return { entities, locality: c ? { name: `${c.name} (mock)`, lat: c.lat, lon: c.lon } : undefined };
  }

  async heatmap(p: QlooParams): Promise<HeatCell[]> {
    await this.tick();
    const signal = String(p["signal.interests.entities"] ?? "").split(",")[0] ?? "";
    let ring: LatLon[] | null = parseWktPolygon(String(p["filter.location"] ?? ""));
    if (!ring && p["filter.location.query"]) {
      const c = findCity(String(p["filter.location.query"]));
      if (c) ring = [-1, 1].flatMap((dy) => [-1, 1].map((dx) => ({ lat: c.lat + dy * 0.4, lon: c.lon + dx * 0.5 }))).sort((a, b) => Math.atan2(a.lat - c.lat, a.lon - c.lon) - Math.atan2(b.lat - c.lat, b.lon - c.lon));
    }
    const out: HeatCell[] = [];
    if (ring) {
      const lats = ring.map((r) => r.lat), lons = ring.map((r) => r.lon);
      const [la0, la1, lo0, lo1] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
      const step = Math.min(0.5, Math.max(0.2, Math.sqrt(((la1 - la0) * (lo1 - lo0)) / 3000)));
      for (let la = Math.ceil(la0 / step) * step; la <= la1; la += step)
        for (let lo = Math.ceil(lo0 / step) * step; lo <= lo1; lo += step) {
          const pt = { lat: round(la), lon: round(lo) };
          if (!inRing(pt, ring) || !onLand(pt)) continue;
          const a = mockAffinityAt(signal, pt.lat, pt.lon);
          out.push({ lat: pt.lat, lon: pt.lon, geohash: `mock${out.length}`, affinity: a, affinityRank: a, popularity: round(0.3 + 0.6 * hash(`${pt.lat},${pt.lon}`)), mock: true });
        }
      // Live heatmaps have cells where people are, so every market has one close by: add a cell at each market centre.
      for (const c of US_CITIES) {
        if (!inRing(c, ring)) continue;
        const a = mockAffinityAt(signal, c.lat, c.lon);
        out.push({ lat: c.lat, lon: c.lon, geohash: `mock${out.length}`, affinity: a, affinityRank: a, popularity: round(0.3 + 0.6 * hash(c.id)), mock: true });
      }
      percentileAffinity(out);
    }
    this.log("/v2/insights", { ...p, "filter.type": "urn:heatmap" }, out);
    return out;
  }

  private pick(pool: Pool, seed: string, take: number, subtype: string, prefix: string): QlooRawEntity[] {
    return pool
      .map((x) => ({ x, s: hash(seed + x.name) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, take)
      .map(({ x, s }) => ({
        name: x.name, entity_id: `mock-${prefix}-${slug(x.name)}`, subtype,
        popularity: round(0.3 + 0.6 * hash(x.name)),
        tags: x.tags.map((t) => ({ name: t })),
        query: { affinity: round(0.6 + 0.38 * s) },
        _mock: true,
      }));
  }
}

/**
 * Live heatmap affinity is a percentile of the cells in the response (checked 2026-10-21: every decile of every live
 * response sits exactly at 0.1, 0.2, ...). Do the same to the mock cells: rank them, ties share the mean rank.
 * The mock profile value stays available as affinityRank.
 */
export function percentileAffinity(cells: HeatCell[]): void {
  const n = cells.length;
  if (n < 2) { for (const c of cells) c.affinity = 1; return; }
  const order = cells.map((c, i) => [c.affinity, i] as const).sort((x, y) => x[0] - y[0]);
  for (let i = 0; i < n;) {
    let j = i;
    while (j + 1 < n && order[j + 1]![0] === order[i]![0]) j++;
    const p = round((i + j) / 2 / (n - 1));
    for (let k = i; k <= j; k++) cells[order[k]![1]]!.affinity = p;
    i = j + 1;
  }
}

/** Crude land mask for mock cells: within ~120 mi of some touring city (keeps cells off the open ocean). */
function onLand(p: LatLon) { return US_CITIES.some((c) => gcMi(c, p) < 120); }

