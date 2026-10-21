/**
 * Tools the Fanpoint agent can call. Every Qloo call is a documented GET on hackathon.api.qloo.com:
 *   /search                                  resolve artist name -> entity id
 *   /v2/insights  urn:heatmap                fan heat along each anchor-to-anchor drive corridor (WKT polygon) and nationwide
 *   /v2/insights  urn:entity:destination     fallback city ranking inside a corridor if the heatmap is empty or fails
 *   /v2/insights  urn:entity:place           rooms whose crowd matches the artist: market-centre POINT + radius, venue tags
 *   /v2/insights  urn:heatmap (localities)   the city's neighborhoods where the artist's fans cluster
 *   /v2/insights  urn:demographics           co-headliners: age / gender skews of both audiences (one call)
 *   /v2/analysis/compare                     co-headliners: taste tags the two acts share
 *   /v2/insights  urn:entity:artist          peers in a popularity band (co-headliners) and local support acts
 *   /v2/insights  urn:entity:brand / podcast cross-domain promo hooks for a city's audience
 *
 * Arguments from the model are validated with zod (the same schemas generate the JSON Schema the model sees).
 * Rankings and numbers are computed here, in code; the model only chooses which tool to call next and writes prose.
 * No tool argument lets the model change a decision: corridor width, peer count, which peers are compared and the
 * touring rules are fixed in code or come from the user's request (touring/rules.ts).
 * Degradation: a non-fatal Qloo failure inside a tool becomes a warning and a smaller result; fatal ones
 * (auth, rate limit after retries, call budget) propagate and end the run with a clear error.
 */
import { z } from "zod";
import { complementarity, THRESHOLDS } from "../cohead/complementarity";
import { isProviderError } from "../net/errors";
import { normalize } from "../qloo/normalize";
import { HOODS_SHOWN, isShowRoom, VENUE_FETCH, VENUE_RADIUS_M, VENUE_TAGS, type FanHood } from "../qloo/venues";
import { sharedTaste, type Demographics } from "../qloo/taste";
import { packCells, readCities, type CityHeat } from "../qloo/heat";
import type { Entity, HeatCell, QlooClient } from "../qloo/types";
import { US_CITIES, findCity } from "../route/cities";
import { corridor, gcMi, LOWER48_WKT } from "../route/geo";
import { fillTour, type Anchor, type FillParams, type FillResult } from "../route/fill";
import { rankGaps, type RankedGap } from "../route/rank";
import type { RoadFn } from "../route/road";
import { RULE_VALUES } from "../touring/rules";
import type { ToolDef } from "../llm/types";
import type { CoheadExtras, Corridor, PeerMatch } from "./types";

// ---------- Argument schemas (single source of truth for validation and for the model-facing JSON Schema) ----------
const id = z.string().trim().min(1).max(200);
const city = z.string().trim().min(1).max(80);
export const ToolArgs = {
  resolve_artist: z.object({ name: z.string().trim().min(1).max(120), role: z.enum(["primary", "partner"]).default("primary") }),
  /** Corridor width is fixed (RULES.corridorBufferMi); a model-supplied width is ignored. */
  scan_corridor: z.object({ artist_id: id, from_city: city, to_city: city }),
  /** No arguments: the user's request and touring/rules.ts set every limit, so the model cannot loosen them. */
  fill_gaps: z.object({}),
  get_city_intel: z.object({ artist_id: id, city }),
  /** Peer count is fixed (RULES.peerCount). */
  find_peer_acts: z.object({ artist_id: id }),
  /** Always compares every peer find_peer_acts returned (plus the user's partner); the model doesn't choose. */
  compare_fan_geography: z.object({ artist_id: id }),
};
export type ToolName = keyof typeof ToolArgs;

const Promo = z.object({ entity_id: z.string(), angle: z.string().max(400) });
/**
 * The model's final output is prose only. Which cities, dates, support acts, rooms and promo partners appear is decided
 * by code (fill_gaps and the Qloo ranking); notes, angles and the summary are checked number-by-number (narrative.ts).
 */
export const SubmitFillSchema = z.object({
  summary: z.string().max(1000).default(""),
  fills: z.array(z.object({ city: z.string(), note: z.string().max(600).default(""), promo: z.array(Promo).default([]) })).max(60).default([]),
});
/** Pitches only: which peers are recommended comes from the computed complementarity ranking. */
export const SubmitCoheadSchema = z.object({ summary: z.string().max(1000).default(""), pitches: z.array(z.object({ peer_id: z.string(), pitch: z.string().max(1200) })).max(10).default([]) });

function def(name: string, description: string, schema: z.ZodType): ToolDef {
  const { $schema: _schema, ...parameters } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return { type: "function", function: { name, description, parameters } };
}
const RESOLVE = def("resolve_artist", "Resolve an artist name to a Qloo artist entity (id, popularity, tags). role=partner for a second act the user wants evaluated as co-headliner.", ToolArgs.resolve_artist);
export const FILL_TOOLS: ToolDef[] = [
  RESOLVE,
  def("scan_corridor", "Read the artist's Qloo fan heatmap inside the drive corridor between two consecutive anchors. Returns touring cities in the corridor ranked by fan heat.", ToolArgs.scan_corridor),
  def("fill_gaps", "Deterministically fill the off days between anchors using the scanned corridors, with the user's max drive per day, no doubling back and night-of-week demand. Call after every corridor is scanned.", ToolArgs.fill_gaps),
  def("get_city_intel", "For one fill city: a local support act no bigger than the artist, the best-matching rooms, and the local audience's top brands and podcasts (promo hooks).", ToolArgs.get_city_intel),
  def("submit_fill", "Submit plain-language notes for the routing fill_gaps produced: a short note per fill city and a promo angle per brand/podcast id. Cities, support acts and rooms are already chosen; any number you write must come from a tool result or the note is dropped.", SubmitFillSchema),
];
export const COHEAD_TOOLS: ToolDef[] = [
  RESOLVE,
  def("find_peer_acts", "Find taste-adjacent peer acts in the artist's popularity band (candidate co-headliners).", ToolArgs.find_peer_acts),
  def("compare_fan_geography", "Read nationwide Qloo fan heatmaps for the artist and each peer, and score how well each peer's strong cities cover the artist's weak ones (and vice versa).", ToolArgs.compare_fan_geography),
  def("submit_cohead", "Submit a one-paragraph pitch for each of the top-ranked peers (the ranking is computed; you write the explanation). Any number you write must come from a tool result or the pitch is dropped.", SubmitCoheadSchema),
];

// ---------- Tool outputs (what the model sees; JSON-serializable) ----------
export interface ToolError { error: string }
export interface Slim { id: string; name: string; affinity?: number; popularity?: number }
export interface ResolveOut { artist: Slim & { tags: string[] }; alternatives: Slim[] }
export interface ScanOut { corridor: string; source: Corridor["source"]; heat_cells: number; cities: { rank: number; name: string; fan_heat: number }[] }
export interface FillGapsOut {
  params_used: { max_drive_mi: number; max_drive_hours: number; max_shows_in_a_row: number; radius_clause_mi: number; min_affinity: number };
  off_days_before: number; off_days_after: number; max_daily_drive_mi: number; max_daily_drive_hours: number; total_mi: number; total_hours: number; longest_run: number;
  road_data: string;
  gaps: { from: string; to: string; direct_mi: number; direct_hours: number; feasible: boolean; note?: string; filled: number; off_days: number; removed: string[] }[];
  calendar: { date: string; dow: string; kind: "anchor" | "fill" | "off"; city?: string; fan_heat?: number; drive_mi?: number; drive_hours?: number; population?: number; venues_10mi?: number }[];
}
/** Rooms farther than this from the city centre (great-circle miles) are not "in" the city, so they are dropped. */
export const VENUE_MAX_MI = 25;
export interface IntelOut { city: string; support: Slim[]; venues: Slim[]; brands: Slim[]; podcasts: Slim[]; fan_neighborhoods: string[] }
export interface PeersOut { peers: Slim[] }
export interface GeoOut {
  thresholds: { strong: number; weak: number }; your_strong_cities: number;
  peers: { id: string; name: string; requested?: boolean; similarity?: number; complementarity: number; strong_cities_combined: number; cities_you_gain: string[]; cities_they_gain: string[]; overlap: number }[];
}
export interface ToolResult<T = unknown> { out: T | ToolError; summary: string }

export interface CityIntel { city: string; support: Entity[]; venues: Entity[]; brands: Entity[]; podcasts: Entity[]; hoods: FanHood[] }
/** Fan neighborhoods must be this close to the stop's centre (great-circle miles). */
export const HOOD_MAX_MI = 15;
/** WKT POINT for a city centre (lon lat, as Qloo expects). */
export const pointWkt = (c: { lat: number; lon: number }) => `POINT(${c.lon.toFixed(4)} ${c.lat.toFixed(4)})`;

/** Shared state across one agent run: every entity any tool returned (used for grounding checks) plus computed artefacts. */
export class Registry {
  readonly entities = new Map<string, Entity>();
  readonly intel = new Map<string, CityIntel>();
  readonly corridors = new Map<string, Corridor>();
  /** artist id -> city -> heat */
  readonly geo = new Map<string, Map<string, CityHeat>>();
  /** Non-fatal problems (failed sub-calls, dropped data), shown to the user with the result. */
  readonly warnings: string[] = [];
  fill?: FillResult;
  /** With Qloo / Without Qloo ranked gap-city lists (route/rank.ts), built from the same hard-filtered set. */
  ranked?: RankedGap[];
  artist?: Entity;
  peers: { entity: Entity; similarity?: number }[] = [];
  matches: PeerMatch[] = [];
  partnerId?: string;
  cohead?: CoheadExtras;
  add(list: Entity[]) { for (const e of list) this.entities.set(e.id, e); return list; }
  warn(msg: string) { if (!this.warnings.includes(msg)) this.warnings.push(msg); }
}

const corridorKey = (from: string, to: string) => `${from}>${to}`;
/** Scores shown to the model are rounded to 2 decimals, so its prose quotes "0.95", not "0.951526032315784". */
const r2 = (x: number | undefined) => (x === undefined ? undefined : Math.round(x * 100) / 100);
const slim = (l: Entity[]): Slim[] => l.map((e) => ({ id: e.id, name: e.name, affinity: r2(e.affinity) }));
const pct = (n?: number) => (n === undefined ? "?" : `${Math.round(n * 100)}`);
const fail = (error: string): ToolResult<never> => ({ out: { error }, summary: `error: ${error}` });
/** Name key for matching a typed artist name to a Qloo result: case, accents, punctuation and a leading "the" ignored. */
export const nameKey = (s: string): string => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/^the /, "");
const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b);

export class Tools {
  /**
   * @param anchors the request's anchors (resolved to coordinates)
   * @param params the request's touring rules; these always win over whatever the model passes to fill_gaps
   */
  constructor(private readonly q: QlooClient, private readonly reg: Registry, private readonly anchors: Anchor[] = [], private readonly params?: FillParams,
    private readonly road?: { leg: RoadFn; source: string }) {}

  /** Validate raw model arguments and dispatch. Unknown tool names and bad arguments come back as tool errors. */
  async call(name: string, rawArgs: Record<string, unknown>): Promise<ToolResult> {
    if (!Object.hasOwn(ToolArgs, name)) return fail(`Unknown tool "${name}".`); // own keys only: "constructor" etc. are not tools
    const tool = name as ToolName;
    const parsed = ToolArgs[tool].safeParse(rawArgs);
    if (!parsed.success) return fail(`Invalid arguments for ${tool}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(args)"} ${i.message}`).join("; ")}`);
    const a = parsed.data;
    switch (tool) {
      case "resolve_artist": return this.resolveArtist(a as z.infer<typeof ToolArgs.resolve_artist>);
      case "scan_corridor": return this.scanCorridor(a as z.infer<typeof ToolArgs.scan_corridor>);
      case "fill_gaps": return this.fillGaps();
      case "get_city_intel": return this.cityIntel(a as z.infer<typeof ToolArgs.get_city_intel>);
      case "find_peer_acts": return this.findPeers(a as z.infer<typeof ToolArgs.find_peer_acts>);
      case "compare_fan_geography": return this.compareGeography(a as z.infer<typeof ToolArgs.compare_fan_geography>);
    }
  }

  /** Non-fatal provider errors become warnings (and the caller falls back); everything else propagates. */
  private soft(e: unknown, what: string): void {
    if (isProviderError(e) && !e.fatal) { this.reg.warn(`${what}: ${e.userMessage}`); return; }
    throw e;
  }
  private knownArtist(artistId: string): string | undefined {
    return this.reg.entities.get(artistId)?.kind === "artist" ? undefined : `Unknown artist_id "${artistId}". Call resolve_artist first and use the id it returns.`;
  }

  private async resolveArtist({ name, role }: z.infer<typeof ToolArgs.resolve_artist>): Promise<ToolResult<ResolveOut>> {
    const raw = await this.q.search(name, ["urn:entity:artist"], 5);
    const list = this.reg.add(raw.map((r) => normalize(r, "urn:entity:artist")));
    if (!list[0]) return fail(`No Qloo artist found for "${name}". Ask the user to check the spelling.`);
    // Live /search always returns its closest matches, even for a made-up name, so
    // only an exact name match (ignoring case, accents, punctuation and a leading "The") counts as found.
    const top = list.find((e) => sameName(e.name, name));
    if (!top) return fail(`No Qloo artist is named "${name}". Closest matches: ${list.slice(0, 3).map((e) => e.name).join(", ")}. Ask the user which one they mean, or to check the spelling.`);
    if (role === "partner") {
      this.reg.partnerId = top.id;
      // Similarity is unknown until find_peer_acts; the partner is assessed even if it is not a peer.
      if (!this.reg.peers.some((p) => p.entity.id === top.id)) this.reg.peers.push({ entity: { ...top, affinity: undefined } });
    } else this.reg.artist = top;
    return {
      out: { artist: { id: top.id, name: top.name, popularity: top.popularity, tags: top.tags }, alternatives: list.filter((x) => x !== top).map((x) => ({ id: x.id, name: x.name })) },
      summary: `→ ${top.name} (${top.id})`,
    };
  }

  // ---------- Fill the gaps ----------
  private async scanCorridor({ artist_id, from_city, to_city }: z.infer<typeof ToolArgs.scan_corridor>): Promise<ToolResult<ScanOut>> {
    const bad = this.knownArtist(artist_id);
    if (bad) return fail(bad);
    const A = findCity(from_city), B = findCity(to_city);
    if (!A || !B) return fail(`Unknown city "${!A ? from_city : to_city}". Use the anchor city names from the request.`);
    const { ring, wkt } = corridor(A, B, RULE_VALUES.corridorBufferMi);
    const label = `${A.name} → ${B.name}`;

    let cells: HeatCell[] = [];
    try { cells = await this.q.heatmap({ "signal.interests.entities": artist_id, "filter.location": wkt }); } catch (e) { this.soft(e, `Fan heatmap for ${label}`); }
    let candidates: CityHeat[] = [];
    let source: Corridor["source"] = "heatmap";
    if (cells.length) {
      // A city takes the strongest heat cell within metroReadRadiusMi (5 mi) of its centre.
      candidates = readCities(cells, US_CITIES, RULE_VALUES.metroReadRadiusMi, ring);
    } else {
      // Fallback: Qloo destination insights inside the same polygon (coarser, but still Qloo data).
      // urn:entity:destination is on the hackathon guide's insights-type list but not on the harness's; if the key
      // lacks it, Qloo answers 403 -> "forbidden" -> soft(): the gap stays open with a warning, the run continues.
      source = "destination";
      try {
        const raw = await this.q.insights({ "filter.type": "urn:entity:destination", "signal.interests.entities": artist_id, "filter.location": wkt, "filter.geocode.country_code": "US", take: 30 });
        candidates = raw.map((r) => normalize(r, "urn:entity:destination")).flatMap((e) => {
          const c = findCity(e.name);
          return c && e.affinity !== undefined ? [{ id: c.id, name: c.name, region: c.region, lat: c.lat, lon: c.lon, affinity: e.affinity, cellDistMi: 0 }] : [];
        }).sort((x, y) => y.affinity - x.affinity);
      } catch (e) { this.soft(e, `City ranking for ${label}`); source = "none"; }
      if (source !== "none" && !candidates.length) source = "none";
      if (source === "none") this.reg.warn(`No Qloo fan data for the ${label} corridor; its off days stay open.`);
    }
    const ex = new Set([A.name.toLowerCase(), B.name.toLowerCase()]);
    const ranked = candidates.filter((c) => !ex.has(c.name.toLowerCase())).map((c, i) => ({ ...c, rank: i + 1 }));
    this.reg.corridors.set(corridorKey(A.name, B.name), { from: A.name, to: B.name, ring, cells: packCells(cells), candidates: ranked, source });
    return {
      out: { corridor: `${A.name} -> ${B.name}`, source, heat_cells: cells.length, cities: ranked.slice(0, 12).map((c) => ({ rank: c.rank, name: c.name, fan_heat: r2(c.affinity)! })) },
      summary: `→ ${label}: ${cells.length} heat cells${source !== "heatmap" ? ` (${source === "destination" ? "destination fallback" : "no data"})` : ""}, ${ranked.length} cities. Top: ${ranked.slice(0, 4).map((c) => `${c.name} ${pct(c.affinity)}`).join(", ") || "-"}`,
    };
  }

  private fillGaps(): ToolResult<FillGapsOut> {
    if (!this.params || !this.road) return fail("fill_gaps is only available for Fill the gaps requests.");
    const sorted = [...this.anchors].sort((a, b) => a.date.localeCompare(b.date));
    const legs = sorted.slice(0, -1).map((a, i) => [a, sorted[i + 1]!] as const);
    const missing = legs.filter(([a, b]) => !this.reg.corridors.has(corridorKey(a.city, b.city))).map(([a, b]) => `${a.city} -> ${b.city}`);
    if (missing.length) return fail(`Scan every corridor first. Missing: ${missing.join(", ")}.`);
    const byGap = legs.map(([a, b]) => (this.reg.corridors.get(corridorKey(a.city, b.city))?.candidates ?? []).map((x) => ({ ...x, rankInCorridor: x.rank })));
    const f = fillTour(sorted, byGap, this.params, this.road.leg);
    this.reg.fill = f;
    const cors = legs.map(([a, b]) => this.reg.corridors.get(corridorKey(a.city, b.city))!);
    this.reg.ranked = rankGaps(sorted, cors.map((c) => c.ring), cors.map((c) => new Map(c.candidates.map((x) => [x.id, { affinity: x.affinity, popularity: x.popularity }]))), US_CITIES, this.params, this.road.leg);
    const p = f.params;
    return {
      out: {
        params_used: { max_drive_mi: p.maxDriveMi, max_drive_hours: p.maxDriveHours, max_shows_in_a_row: p.maxConsecutiveShows, radius_clause_mi: p.radiusMi, min_affinity: p.minAffinity },
        off_days_before: f.offBefore, off_days_after: f.offAfter, max_daily_drive_mi: f.maxDayDrive, max_daily_drive_hours: f.maxDayHours, total_mi: f.totalMi, total_hours: f.totalHours,
        longest_run: f.longestRun, road_data: this.road.source,
        gaps: f.gaps.map((g) => ({ from: g.from, to: g.to, direct_mi: g.directMi, direct_hours: g.directHours, feasible: g.feasible, note: g.note, filled: g.filled, off_days: g.offDays,
          removed: g.considered.filter((c) => c.status !== "picked" && c.status !== "didn't fit schedule").map((c) => `${c.name} (${c.status})`) })),
        calendar: f.calendar.map((d) => {
          const m = d.city ? findCity(d.city) : undefined;
          return { date: d.date, dow: d.dow, kind: d.kind, city: d.city, fan_heat: r2(d.affinity), drive_mi: d.driveMi, drive_hours: d.driveHours, population: m?.population, venues_10mi: m?.venues.total };
        }),
      },
      summary: `→ off days ${f.offBefore} → ${f.offAfter}; longest day ${f.maxDayDrive} mi / ${f.maxDayHours} h (OSRM road data); max ${f.longestRun} shows in a row`,
    };
  }

  private async cityIntel({ artist_id, city: cityName }: z.infer<typeof ToolArgs.get_city_intel>): Promise<ToolResult<IntelOut>> {
    const bad = this.knownArtist(artist_id);
    if (bad) return fail(bad);
    const c = findCity(cityName);
    if (!c) return fail(`Unknown city "${cityName}".`);
    const pop = this.reg.artist?.popularity;
    // A bare city name ("Washington", "Richmond") can resolve to a same-named place in another state or country,
    // so always name the state.
    const where = c.name.includes(",") ? c.name : `${c.name}, ${c.state}`;
    // Rooms and neighborhoods use the market centre as a POINT + radius, not a locality name: "Camden, NJ" matched
    // Camden County live, which widened the area. A radius is the same size in every city.
    const area = { "filter.location": pointWkt(c), "filter.location.radius": VENUE_RADIUS_M };
    const parts = [
      // Support act: taste-adjacent, local, and no bigger than the artist (popularity ceiling).
      ["support acts", "urn:entity:artist", { "filter.type": "urn:entity:artist", "signal.interests.entities": artist_id, "signal.location.query": where, "filter.exclude.entities": artist_id, "filter.popularity.max": pop, take: 3 }],
      ["rooms", "urn:entity:place", { "filter.type": "urn:entity:place", "signal.interests.entities": artist_id, ...area, "filter.tags": VENUE_TAGS.join(","), take: VENUE_FETCH }],
      ["brands", "urn:entity:brand", { "filter.type": "urn:entity:brand", "signal.interests.entities": artist_id, "signal.location.query": where, take: 2 }],
      ["podcasts", "urn:entity:podcast", { "filter.type": "urn:entity:podcast", "signal.interests.entities": artist_id, "signal.location.query": where, take: 2 }],
    ] as const;
    // One failed sub-call must not cost the whole city: settle all of them, degrade the failures to empty lists.
    const [settled, heat] = await Promise.all([
      Promise.allSettled(parts.map(([, , params]) => this.q.insights(params))),
      this.q.localityHeat({ "signal.interests.entities": artist_id, ...area }).then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e })),
    ]);
    const lists = settled.map((s, i) => {
      const [what, type] = parts[i]!;
      if (s.status === "fulfilled") return s.value.map((r) => normalize(r, type));
      this.soft(s.reason, `${c.name} ${what}`);
      return [];
    });
    const [support = [], rooms = [], brands = [], podcasts = []] = lists;
    this.reg.add(support); this.reg.add(brands); this.reg.add(podcasts);
    // A room must host shows (category whitelist) and be in or near the city (VENUE_MAX_MI from the centre).
    const shows = rooms.filter((v) => isShowRoom(v.place?.category));
    const venues = this.reg.add(shows.filter((v) => v.lat === undefined || v.lon === undefined || gcMi({ lat: v.lat, lon: v.lon }, c) <= VENUE_MAX_MI)
      .sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1)));
    if (venues.length < shows.length) this.reg.warn(`${c.name}: ${shows.length - venues.length} Qloo room(s) more than ${VENUE_MAX_MI} mi from the city were dropped.`);
    let hoods: FanHood[] = [];
    if (heat.ok) {
      hoods = heat.v.filter((h) => h.level === "neighborhood" && h.lat !== undefined && h.lon !== undefined && gcMi({ lat: h.lat, lon: h.lon }, c) <= HOOD_MAX_MI)
        .sort((a, b) => b.affinity - a.affinity).slice(0, HOODS_SHOWN)
        .map((h) => ({ id: h.id, name: h.name, city: h.city, affinity: h.affinity, lat: h.lat, lon: h.lon }));
    } else this.soft(heat.e, `${c.name} fan neighborhoods`);
    const intel: CityIntel = { city: c.name, support, venues, brands, podcasts, hoods };
    this.reg.intel.set(c.name.toLowerCase(), intel);
    return {
      out: { city: c.name, support: slim(support), venues: slim(venues.slice(0, 3)), brands: slim(brands), podcasts: slim(podcasts), fan_neighborhoods: hoods.map((h) => h.name) },
      summary: `→ ${c.name}: support ${support[0]?.name ?? "-"}, room ${venues[0]?.name ?? "-"}${hoods.length ? `, fans in ${hoods.map((h) => h.name).join(", ")}` : ""}`,
    };
  }

  // ---------- Co-headliner matching ----------
  private async findPeers({ artist_id }: z.infer<typeof ToolArgs.find_peer_acts>): Promise<ToolResult<PeersOut>> {
    const bad = this.knownArtist(artist_id);
    if (bad) return fail(bad);
    const pop = this.reg.artist?.popularity;
    // Peers within the popularity band: a co-headline needs acts of roughly equal draw.
    const w = RULE_VALUES.peerPopularityBand;
    const band = pop !== undefined ? { "filter.popularity.min": Math.max(0, +(pop - w).toFixed(3)), "filter.popularity.max": Math.min(1, +(pop + w).toFixed(3)) } : {};
    const raw = await this.q.insights({ "filter.type": "urn:entity:artist", "signal.interests.entities": artist_id, "filter.exclude.entities": artist_id, ...band, take: RULE_VALUES.peerCount });
    const peers = this.reg.add(raw.map((r) => normalize(r, "urn:entity:artist")));
    const partner = this.reg.peers.find((p) => p.entity.id === this.reg.partnerId);
    this.reg.peers = peers.map((e) => ({ entity: e, similarity: e.affinity }));
    if (partner && !peers.some((p) => p.id === partner.entity.id)) this.reg.peers.push(partner);
    return {
      out: { peers: peers.map((p) => ({ id: p.id, name: p.name, affinity: r2(p.affinity), popularity: r2(p.popularity) })) },
      summary: `→ ${peers.length} peers: ${peers.slice(0, 4).map((p) => p.name).join(", ")}${peers.length > 4 ? "…" : ""}`,
    };
  }

  /** Nationwide fan heat per touring city for one act (cached per run). A city takes the best cell within 30 mi. */
  private async geography(artistId: string): Promise<Map<string, CityHeat>> {
    const hit = this.reg.geo.get(artistId);
    if (hit) return hit;
    const cells = await this.q.heatmap({ "signal.interests.entities": artistId, "filter.location": LOWER48_WKT });
    const m = new Map(readCities(cells, US_CITIES, RULE_VALUES.nationalReadRadiusMi).map((c) => [c.name, c]));
    this.reg.geo.set(artistId, m);
    return m;
  }

  private async compareGeography({ artist_id }: z.infer<typeof ToolArgs.compare_fan_geography>): Promise<ToolResult<GeoOut>> {
    const bad = this.knownArtist(artist_id);
    if (bad) return fail(bad);
    // Every peer this run saw (grounding), most taste-similar first, the user's partner always included: at most
    // peerCount + 1 heatmaps. Chosen by code so the model can't skip an inconvenient peer.
    const known = new Map(this.reg.peers.map((p) => [p.entity.id, p]));
    const bySimilarity = [...this.reg.peers].sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1)).map((p) => p.entity.id);
    const ids = [...new Set([...(this.reg.partnerId ? [this.reg.partnerId] : []), ...bySimilarity])].filter((x) => x !== artist_id && known.has(x)).slice(0, RULE_VALUES.peerCount + 1);
    if (!ids.length) return fail("No known peer ids. Call find_peer_acts first and pass the ids it returns.");
    const you = await this.geography(artist_id);
    if (!you.size) return fail("Qloo returned no fan heat for this artist, so complementarity cannot be scored.");
    const heat = (m: Map<string, CityHeat>) => new Map([...m].map(([k, v]) => [k, v.affinity]));
    const yourHeat = heat(you);

    const theirs = await Promise.allSettled(ids.map((x) => this.geography(x)));
    const matches: PeerMatch[] = [];
    theirs.forEach((s, i) => {
      const peer = known.get(ids[i]!)!; // ids were filtered to known peers above
      if (s.status === "rejected") { this.soft(s.reason, `Fan heatmap for ${peer.entity.name}`); return; }
      const c = complementarity(yourHeat, heat(s.value));
      matches.push({ entity: peer.entity, similarity: peer.similarity, picked: false, requested: peer.entity.id === this.reg.partnerId, ...c });
    });
    if (!matches.length) return fail("Every peer heatmap failed; try again shortly.");
    // Highest complementarity first; ties go to the larger combined strong-city coverage.
    this.reg.matches = matches.sort((a, b) => b.score - a.score || b.coveredStrong - a.coveredStrong);
    const top = this.reg.matches[0]!;
    return {
      out: {
        thresholds: { ...THRESHOLDS }, your_strong_cities: top.youStrong,
        peers: this.reg.matches.map((m) => ({ id: m.entity.id, name: m.entity.name, requested: m.requested, similarity: m.similarity, complementarity: m.score, strong_cities_combined: m.coveredStrong,
          cities_you_gain: m.youGain.slice(0, 6), cities_they_gain: m.theyGain.slice(0, 6), overlap: m.overlap.length })),
      },
      summary: `→ best complement: ${top.entity.name} (+${top.youGain.length} cities for you, +${top.theyGain.length} for them)`,
    };
  }

  // ---------- Co-headliner extras (code-driven, after compare_fan_geography) ----------
  /**
   * For the peers worth showing: one demographics call for everyone, then per peer the taste tags both audiences share
   * and a joint room in the pair's best shared city (the city where the weaker of the two heats is highest).
   * Every part degrades softly: a failure costs that panel, never the plan.
   */
  async coheadExtras(artistId: string, peerIds: string[]): Promise<{ extras: CoheadExtras; summary: string }> {
    const extras: CoheadExtras = { skews: {}, byPeer: {} };
    const ids = [...new Set(peerIds)].filter((x) => x !== artistId);
    const you = this.reg.geo.get(artistId);
    type Joint = NonNullable<CoheadExtras["byPeer"][string]["joint"]>;
    const onePeer = async (pid: string) => {
      const shared = await this.q.compare(artistId, pid).then((t) => sharedTaste(t), (e: unknown) => { this.soft(e, "Shared taste"); return []; });
      const them = this.reg.geo.get(pid);
      let joint: Joint | undefined;
      for (const c of you?.values() ?? []) {
        const t = them?.get(c.name)?.affinity;
        if (t !== undefined && (!joint || Math.min(c.affinity, t) > Math.min(joint.you, joint.them))) joint = { city: c.name, region: c.region, you: c.affinity, them: t };
      }
      const at = joint && you?.get(joint.city);
      if (joint && at) {
        try {
          const raw = await this.q.insights({ "filter.type": "urn:entity:place", "signal.interests.entities": `${artistId},${pid}`, "filter.location": pointWkt(at), "filter.location.radius": VENUE_RADIUS_M, "filter.tags": VENUE_TAGS.join(","), take: VENUE_FETCH });
          joint.venue = this.reg.add(raw.map((r) => normalize(r, "urn:entity:place"))
            .filter((v) => isShowRoom(v.place?.category) && (v.lat === undefined || v.lon === undefined || gcMi({ lat: v.lat, lon: v.lon }, at) <= VENUE_MAX_MI))
            .sort((x, y) => (y.affinity ?? -1) - (x.affinity ?? -1)).slice(0, 1))[0];
        } catch (e) { this.soft(e, `Joint room in ${joint.city}`); }
      }
      extras.byPeer[pid] = { shared, joint };
    };
    const [demo] = await Promise.all([
      this.q.demographics([artistId, ...ids]).then((d) => d, (e: unknown) => { this.soft(e, "Audience demographics"); return [] as Demographics[]; }),
      ...ids.map(onePeer),
    ]);
    for (const d of demo) extras.skews[d.entityId] = d;
    this.reg.cohead = extras;
    const rooms = Object.values(extras.byPeer).filter((p) => p.joint?.venue).length;
    return { extras, summary: `→ audience skews for ${Object.keys(extras.skews).length} acts, shared taste + joint rooms for ${ids.length} peers (${rooms} rooms found)` };
  }
}
