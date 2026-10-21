/**
 * "Fill the gaps": given fixed anchor shows (city + date), choose shows for the off days in between.
 *
 * One deterministic dynamic programme per gap (anchor A -> anchor B). Every default comes from touring/rules.ts, which
 * cites a source for each value or labels it an adjustable assumption. Hard rules:
 *   - drive: a hop over k days may cover at most maxDriveMi x k road miles AND maxDriveHours x k hours, on real road
 *     distances and drive times (OSRM on OpenStreetMap, see road.ts);
 *   - reachability: from every fill, B must still be reachable in the days left;
 *   - no doubling back: each stop must be >= progressMi closer to B and >= departMi further from A than the last one;
 *   - radius clause: no fill within radiusMi (straight line, as such clauses are usually written) of either anchor;
 *   - spacing: consecutive fills >= spacingMi apart, so they don't split one market;
 *   - days off: at most maxConsecutiveShows show days in a row (anchors count);
 *   - real venue: a market needs >= minVenues OpenStreetMap-mapped live-performance venues within 10 mi;
 *   - each city at most once per tour; anchors are never fills.
 * Objective: maximise sum over fills of (Qloo fan heat x night-of-week weight - nightFloor), minus a tiny per-mile
 * tie-break. Subtracting nightFloor means a weak market on a weak night scores <= 0, so the DP leaves the night off.
 * The road function is injected: production passes the OSRM matrix; unit tests pass a simple geometric stand-in.
 */
import { gcMi, type LatLon } from "./geo";
import type { Leg, RoadFn } from "./road";
import { RULE_VALUES as R } from "../touring/rules";
import { findMarket, MARKETS_META, marketById } from "../data/markets";

export interface Anchor extends LatLon { id?: string; city: string; region?: string; date: string; label?: string }
export interface Candidate extends LatLon { id?: string; name: string; region?: string; affinity: number; rankInCorridor?: number }
export interface FillParams {
  maxDriveMi: number;
  /** Heat floor: candidates below this Qloo affinity are not considered at all. */
  minAffinity: number;
  /** Sun..Sat demand weights (7 values, each 0..1). */
  dowWeights: readonly number[];
  /** A fill must beat an off day: affinity x night weight must exceed this. */
  nightFloor?: number;
  /** Radius clause: no fill within this many miles (great-circle) of an anchor. */
  radiusMi?: number;
  /** Minimum great-circle spacing between consecutive shows. */
  spacingMi?: number;
  /** Max road hours of driving per day (OSRM drive time). */
  maxDriveHours?: number;
  /** Max show days in a row before a day off (anchors count). */
  maxConsecutiveShows?: number;
  /** 1 = never fill Thanksgiving Day, Dec 24 or Dec 25 (see holidayName); 0 = allow. */
  holidaysOff?: number;
}
export interface Day {
  date: string; dow: string; kind: "anchor" | "fill" | "off";
  id?: string; city?: string; region?: string; lat?: number; lon?: number; label?: string;
  affinity?: number; dowWeight?: number; driveMi?: number; driveHours?: number; driveDays?: number; rankInCorridor?: number;
  /** Show days in a row up to and including this one. */
  run?: number;
  /** Off days only: kept off because of the holidays rule (the holiday's name). */
  holiday?: string;
}
export type CandidateStatus = "picked" | "below heat floor" | "radius clause" | "off route / backtrack" | "no mapped venue" | "used elsewhere" | "no road route" | "didn't fit schedule";
export interface Considered { name: string; affinity: number; status: CandidateStatus; detail?: string }
export interface GapPlan {
  from: string; to: string; directMi: number; directHours: number; offDays: number; filled: number;
  /** false when the anchors themselves break the rules (B not after A, or B unreachable in time). */
  feasible: boolean; note?: string; days: Day[]; considered: Considered[];
}
export interface FillResult {
  gaps: GapPlan[]; calendar: Day[]; offBefore: number; offAfter: number; fills: number;
  /** Longest single-day drive (multi-day hops are averaged per day). */
  maxDayDrive: number; maxDayHours: number; totalMi: number; totalHours: number;
  /** Longest run of consecutive show days (anchors included). */
  longestRun: number;
  params: Required<FillParams>;
}

export const DEFAULT_PARAMS: Required<FillParams> = {
  maxDriveMi: R.maxDriveMi, minAffinity: R.minAffinity, dowWeights: R.dowWeights, nightFloor: R.nightFloor,
  radiusMi: R.radiusMi, spacingMi: R.spacingMi, maxDriveHours: R.maxDriveHours, maxConsecutiveShows: R.maxConsecutiveShows,
  holidaysOff: R.holidaysOff,
};
export const PROGRESS_MI = R.progressMi;
export const DEPART_MI = R.departMi;
export const MILE_PENALTY = R.milePenalty;

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const NONE: Leg = { mi: Infinity, hours: Infinity };

// Dates are ISO yyyy-mm-dd, handled at UTC noon so DST and the server's zone can't shift a day.
const noon = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
export const addDays = (iso: string, n: number) => new Date(noon(iso) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((noon(b) - noon(a)) / 86_400_000);
export const dowOf = (iso: string) => new Date(noon(iso)).getUTCDay();
const dowName = (iso: string) => DOW[dowOf(iso)] ?? "?";
/** true for a real calendar date in yyyy-mm-dd form (rejects 2026-02-30). */
export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(noon(s)) && addDays(s, 0) === s;

/**
 * US major travel holidays Fanpoint keeps off by default: Thanksgiving Day (4th Thursday of November), Christmas Eve,
 * Christmas Day. New Year's Eve is deliberately not on the list (a big show night).
 */
export function holidayName(iso: string): string | undefined {
  const [, m, d] = iso.split("-").map(Number);
  if (m === 12 && d === 24) return "Christmas Eve";
  if (m === 12 && d === 25) return "Christmas Day";
  if (m === 11 && dowOf(iso) === 4 && d! >= 22 && d! <= 28) return "Thanksgiving";
  return undefined;
}

/** Throws on parameter values that would make the DP meaningless (programmer error, not user input). */
export function assertParams(p: FillParams): void {
  if (!(p.maxDriveMi > 0)) throw new RangeError("maxDriveMi must be > 0");
  if (!(p.minAffinity >= 0 && p.minAffinity <= 1)) throw new RangeError("minAffinity must be within 0..1");
  if (p.dowWeights.length !== 7 || p.dowWeights.some((w) => !(w >= 0 && w <= 1))) throw new RangeError("dowWeights needs 7 values within 0..1 (Sun..Sat)");
  if (p.maxDriveHours !== undefined && !(p.maxDriveHours > 0)) throw new RangeError("maxDriveHours must be > 0");
  if (p.maxConsecutiveShows !== undefined && !(Number.isInteger(p.maxConsecutiveShows) && p.maxConsecutiveShows >= 1)) throw new RangeError("maxConsecutiveShows must be an integer >= 1");
}

const offDay = (date: string, p?: Pick<FillParams, "holidaysOff">): Day => {
  const h = p?.holidaysOff ? holidayName(date) : undefined;
  return h ? { date, dow: dowName(date), kind: "off", holiday: h } : { date, dow: dowName(date), kind: "off" };
};
const offDays = (start: string, n: number, p?: Pick<FillParams, "holidaysOff">): Day[] => Array.from({ length: Math.max(0, n) }, (_, k) => offDay(addDays(start, k + 1), p));
/** Does a leg fit in `days` days under both drive limits? */
export const fits = (l: Leg, days: number, p: Required<FillParams>) => l.mi <= p.maxDriveMi * days && l.hours <= p.maxDriveHours * days;

/**
 * Why a candidate is excluded before the DP runs (undefined = eligible). Geometry rules use straight-line miles.
 * `heatFloor: false` skips the only Qloo-based check, leaving the hard filters that need no taste data (used by the
 * With/Without Qloo ranked lists in rank.ts, so both lists start from the identical candidate set).
 */
export function screen(c: Candidate, A: Anchor, B: Anchor, p: Required<FillParams>, used: Set<string>, road: RoadFn, heatFloor = true): { status: CandidateStatus; detail?: string } | undefined {
  if (used.has(c.name.toLowerCase())) return { status: "used elsewhere" };
  const dA = gcMi(A, c), dB = gcMi(c, B);
  if (dA < p.radiusMi || dB < p.radiusMi) return { status: "radius clause", detail: `${Math.round(Math.min(dA, dB))} mi from ${dA < dB ? A.city : B.city}` };
  // Must lie "between" the anchors: closer to each anchor than the anchors are to each other.
  const AB = gcMi(A, B);
  if (!(dA < AB && dB < AB)) return { status: "off route / backtrack" };
  // Real venue required: a known market with no OSM-mapped live-performance venue can't host a show. Points that are
  // not markets (synthetic test coordinates) have no count and are not judged.
  const m = marketById(c.id) ?? findMarket(c.name);
  if (m && m.venues.total < R.minVenues) return { status: "no mapped venue", detail: `0 within ${MARKETS_META.venueRadiusMi} mi (OSM)` };
  if (heatFloor && c.affinity < p.minAffinity) return { status: "below heat floor" };
  if (!road(A, c) || !road(c, B)) return { status: "no road route" };
  return undefined;
}

/**
 * Fill the off days strictly between A.date and B.date. `used` holds lower-cased city names already on the tour;
 * cities picked here are added to it (so later gaps can't reuse them). `runAtA` = show days in a row ending with A.
 */
export function fillGap(A: Anchor, B: Anchor, cands: Candidate[], params: FillParams, used: Set<string>, road: RoadFn, runAtA = 1): GapPlan & { runAtB: number } {
  const p: Required<FillParams> = { ...DEFAULT_PARAMS, ...params };
  const legOf = (a: Anchor | Candidate | LatLon, b: Anchor | Candidate | LatLon) => road(a, b) ?? NONE;
  const span = daysBetween(A.date, B.date); // days from A's show to B's show
  const n = span - 1; // off days in between
  const direct = legOf(A, B);
  const directMi = Math.round(direct.mi), directHours = Math.round(direct.hours * 10) / 10;
  const base = { from: A.city, to: B.city, directMi, directHours, offDays: Math.max(0, n), filled: 0, feasible: true, days: [] as Day[], considered: [] as Considered[], runAtB: 1 };
  if (span <= 0) return { ...base, feasible: false, note: `${B.city} is not after ${A.city}.` };
  if (!Number.isFinite(direct.mi)) return { ...base, feasible: false, days: offDays(A.date, n, p), note: `No road route is known between ${A.city} and ${B.city}.` };
  if (!fits(direct, span, p))
    return { ...base, feasible: false, days: offDays(A.date, n, p), note: `${A.city} to ${B.city} is ${directMi} road mi / ${directHours} h in ${span} day(s), over the ${p.maxDriveMi} mi or ${p.maxDriveHours} h per day limit.` };
  if (n === 0) return { ...base, runAtB: runAtA + 1, note: runAtA + 1 > p.maxConsecutiveShows ? `Back-to-back anchors make ${runAtA + 1} shows in a row (limit ${p.maxConsecutiveShows}).` : undefined };

  const considered: Considered[] = [];
  const pool: Candidate[] = [];
  for (const c of cands) {
    const r = screen(c, A, B, p, used, road);
    if (r) considered.push({ name: c.name, affinity: c.affinity, ...r });
    else pool.push(c);
  }

  // best[d] maps "poolIndex|run" -> best route that plays pool[i] on day d with `run` show days in a row so far.
  // prev = [day, key]; key "A" means anchor A (day 0).
  type Node = { score: number; prev: [number, string]; i: number; run: number };
  const best: Map<string, Node>[] = Array.from({ length: n + 1 }, () => new Map());
  const locOf = (i: number): Anchor | Candidate => (i < 0 ? A : pool[i] ?? A);
  // Why an unpicked city never fit: the furthest check it reached (drive < route < shows in a row), for the filter view.
  const blocked = new Map<number, number>(), placed = new Set<number>();
  const block = (i: number, level: number) => { if ((blocked.get(i) ?? -1) < level) blocked.set(i, level); };

  for (let d = 1; d <= n; d++) {
    if (p.holidaysOff && holidayName(addDays(A.date, d))) continue; // holidays rule: this day stays off
    const w = p.dowWeights[dowOf(addDays(A.date, d))] ?? 0;
    pool.forEach((c, i) => {
      if (!fits(legOf(c, B), span - d, p)) { block(i, 1); return; } // B must stay reachable
      const value = c.affinity * w - p.nightFloor;
      if (value <= 0) { block(i, 0); return; } // not worth more than a night off
      const consider = (pd: number, pi: number, prevRun: number, prevScore: number, prevKey: string) => {
        const from = locOf(pi);
        const hop = legOf(from, c);
        if (!fits(hop, d - pd, p)) { block(i, 1); return; } // drive limits, scaled by the days available for this hop
        if (pi >= 0 && gcMi(from, c) < p.spacingMi) { block(i, 2); return; } // too close to the previous fill
        // No doubling back: strictly forward progress towards B, and away from A.
        if (!(gcMi(c, B) < gcMi(from, B) - PROGRESS_MI && gcMi(A, c) > gcMi(A, from) + DEPART_MI)) { block(i, 2); return; }
        const run = pd === d - 1 ? prevRun + 1 : 1; // a gap day in between resets the streak
        if (run > p.maxConsecutiveShows || (d === n && run + 1 > p.maxConsecutiveShows)) { block(i, 3); return; } // B (the next day) would extend the streak
        placed.add(i);
        const s = prevScore + value - hop.mi * MILE_PENALTY;
        const key = `${i}|${run}`;
        const cur = best[d]!.get(key);
        if (!cur || s > cur.score) best[d]!.set(key, { score: s, prev: [pd, prevKey], i, run });
      };
      consider(0, -1, runAtA, 0, "A");
      for (let pd = 1; pd < d; pd++) for (const [k, node] of best[pd]!) consider(pd, node.i, node.run, node.score, k);
    });
  }

  // Best terminal node (score must be > 0, i.e. better than leaving the whole gap off), then walk back.
  let end: [number, string] | undefined, endScore = 0;
  for (let d = 1; d <= n; d++) for (const [k, node] of best[d]!) if (node.score > endScore) { endScore = node.score; end = [d, k]; }
  const chosen = new Map<number, Node>(); // day -> node
  for (let cur = end; cur && cur[1] !== "A"; ) {
    const node = best[cur[0]]?.get(cur[1]);
    if (!node) break;
    chosen.set(cur[0], node);
    cur = node.prev;
  }

  const days: Day[] = [];
  let lastLoc: Anchor | Candidate = A, lastDay = 0;
  for (let d = 1; d <= n; d++) {
    const date = addDays(A.date, d);
    const node = chosen.get(d);
    const c = node ? pool[node.i] : undefined;
    if (!node || !c) { days.push(offDay(date, p)); continue; }
    used.add(c.name.toLowerCase());
    const hop = legOf(lastLoc, c);
    days.push({ date, dow: dowName(date), kind: "fill", id: c.id, city: c.name, region: c.region, lat: c.lat, lon: c.lon, affinity: c.affinity,
      dowWeight: p.dowWeights[dowOf(date)], driveMi: Math.round(hop.mi), driveHours: hop.hours, driveDays: d - lastDay, rankInCorridor: c.rankInCorridor, run: node.run });
    lastLoc = c; lastDay = d;
  }
  const last = chosen.get(n);
  const runAtB = last ? last.run + 1 : 1;
  const picked = new Set(days.flatMap((x) => (x.kind === "fill" && x.city ? [x.city] : [])));
  const unfit = (i: number) => placed.has(i) ? "a higher-scoring route used these days"
    : !blocked.has(i) ? "no open day it could play"
    : [`heat × night weight never beats the ${p.nightFloor} night floor`, `over ${p.maxDriveMi} mi or ${p.maxDriveHours} h a day`, "too close to the previous stop or doubles back", `would make more than ${p.maxConsecutiveShows} shows in a row`][blocked.get(i)!];
  pool.forEach((c, i) => considered.push(picked.has(c.name) ? { name: c.name, affinity: c.affinity, status: "picked" } : { name: c.name, affinity: c.affinity, status: "didn't fit schedule", detail: unfit(i) }));
  considered.sort((a, b) => b.affinity - a.affinity);
  const note = picked.size ? undefined
    : !cands.length ? "No candidate cities were read for this corridor."
    : !pool.length ? "Every candidate was removed by the touring rules (see the filter)."
    : "No remaining candidate beats an off day within the drive and days-off limits.";
  return { ...base, filled: picked.size, days, considered, note, runAtB };
}

/** Drive into anchor B: from the last fill of the gap (or from A if none), and over how many days. */
function arrival(g: GapPlan | undefined, A: Anchor, B: Anchor, road: RoadFn): { leg: Leg; days: number } {
  const span = daysBetween(A.date, B.date);
  let from: Anchor | Candidate | Day = A, days = span;
  g?.days.forEach((d, i) => { if (d.kind === "fill" && d.lat !== undefined && d.lon !== undefined) { from = d as Day; days = span - (i + 1); } });
  const pt = from as { id?: string; lat: number; lon: number };
  return { leg: road({ id: pt.id, lat: pt.lat, lon: pt.lon }, B) ?? NONE, days };
}

/**
 * Fill every gap of a tour. Anchors are sorted by date first; `candidatesByGap[k]` must belong to the gap between
 * the k-th and (k+1)-th anchor *in date order*.
 */
export function fillTour(anchors: Anchor[], candidatesByGap: Candidate[][], params: FillParams, road: RoadFn): FillResult {
  assertParams(params);
  const p: Required<FillParams> = { ...DEFAULT_PARAMS, ...params };
  const sorted = [...anchors].sort((a, b) => a.date.localeCompare(b.date));
  const used = new Set(sorted.map((a) => a.city.toLowerCase()));
  const gaps: GapPlan[] = [];
  const calendar: Day[] = [];
  let run = 1;
  sorted.forEach((a, k) => {
    const prevA = sorted[k - 1];
    const arr = prevA ? arrival(gaps[k - 1], prevA, a, road) : undefined;
    calendar.push({ date: a.date, dow: dowName(a.date), kind: "anchor", id: a.id, city: a.city, region: a.region, lat: a.lat, lon: a.lon, label: a.label,
      driveMi: arr && (Number.isFinite(arr.leg.mi) ? Math.round(arr.leg.mi) : undefined), driveHours: arr && (Number.isFinite(arr.leg.hours) ? arr.leg.hours : undefined), driveDays: arr?.days, run });
    const next = sorted[k + 1];
    if (!next) return;
    const { runAtB, ...g } = fillGap(a, next, candidatesByGap[k] ?? [], p, used, road, run);
    gaps.push(g);
    calendar.push(...g.days);
    run = runAtB;
  });
  let totalMi = 0, totalHours = 0, maxDayDrive = 0, maxDayHours = 0, longestRun = 0, streak = 0;
  for (const d of calendar) {
    if (d.driveMi !== undefined) { totalMi += d.driveMi; maxDayDrive = Math.max(maxDayDrive, Math.round(d.driveMi / Math.max(1, d.driveDays ?? 1))); }
    if (d.driveHours !== undefined) { totalHours += d.driveHours; maxDayHours = Math.max(maxDayHours, Math.round((d.driveHours / Math.max(1, d.driveDays ?? 1)) * 10) / 10); }
    streak = d.kind === "off" ? 0 : streak + 1;
    longestRun = Math.max(longestRun, streak);
  }
  const offBefore = gaps.reduce((s, g) => s + g.offDays, 0);
  const fills = gaps.reduce((s, g) => s + g.filled, 0);
  return { gaps, calendar, offBefore, offAfter: offBefore - fills, fills, maxDayDrive, maxDayHours, totalMi, totalHours: Math.round(totalHours * 10) / 10, longestRun, params: p };
}

export interface AuditRow {
  city: string; date: string; anchor: boolean; driveMi?: number; driveHours?: number; perDay?: number;
  overDrive: boolean; doublesBack: boolean; radiusConflict?: string;
  /** Set when a proposed stop is not on an off day: outside the tour window, on an anchor date, or a double booking. */
  dateConflict?: string;
  /** No road route known for this hop (city outside the market universe, or unroutable). */
  noRoute?: boolean;
}

/**
 * Audit any proposed sequence of stops (e.g. a plain-AI answer) against the same touring rules the DP enforces, on the
 * same road data. Looser than the DP on purpose (only flags clear breaks): doubling back = ending a hop more than
 * DEPART_MI further from the next anchor than where the hop started.
 */
export function auditSequence(anchors: Anchor[], stops: (LatLon & { id?: string; city: string; date: string })[], params: FillParams, road: RoadFn): AuditRow[] {
  const p: Required<FillParams> = { ...DEFAULT_PARAMS, ...params };
  const sortedA = [...anchors].sort((a, b) => a.date.localeCompare(b.date));
  const first = sortedA[0]?.date, last = sortedA[sortedA.length - 1]?.date;
  const anchorDates = new Set(sortedA.map((a) => a.date));
  const seen = new Set<string>();
  const seq = [...sortedA.map((a) => ({ ...a, anchor: true })), ...stops.map((s) => ({ ...s, anchor: false }))]
    .sort((a, b) => a.date.localeCompare(b.date) || Number(b.anchor) - Number(a.anchor));
  return seq.map((s, i): AuditRow => {
    let dateConflict: string | undefined;
    if (!s.anchor) {
      if (!first || !last || s.date <= first || s.date >= last) dateConflict = anchorDates.has(s.date) ? "same day as an anchor" : "outside the tour dates";
      else if (anchorDates.has(s.date)) dateConflict = "same day as an anchor";
      else if (seen.has(s.date)) dateConflict = "two shows on one day";
      seen.add(s.date);
    }
    const prev = seq[i - 1];
    if (!prev) return { city: s.city, date: s.date, anchor: s.anchor, overDrive: false, doublesBack: false, dateConflict };
    const days = Math.max(1, daysBetween(prev.date, s.date));
    const leg = road(prev, s);
    const nextA = sortedA.find((a) => a.date >= s.date) ?? sortedA[sortedA.length - 1];
    const doublesBack = !s.anchor && !!nextA && gcMi(s, nextA) > gcMi(prev, nextA) + DEPART_MI;
    const radiusConflict = s.anchor ? undefined : sortedA.find((a) => gcMi(a, s) < p.radiusMi)?.city;
    if (!leg) return { city: s.city, date: s.date, anchor: s.anchor, overDrive: false, doublesBack, radiusConflict, dateConflict, noRoute: true };
    return { city: s.city, date: s.date, anchor: s.anchor, driveMi: Math.round(leg.mi), driveHours: leg.hours, perDay: Math.round(leg.mi / days),
      overDrive: !fits(leg, days, p), doublesBack, radiusConflict, dateConflict };
  });
}
