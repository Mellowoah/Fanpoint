import { describe, expect, it } from "vitest";
import {
  addDays, assertParams, daysBetween, DEFAULT_PARAMS, DEPART_MI, dowOf, fillGap as fillGapOn, fillTour as fillTourOn, isIsoDate,
  MILE_PENALTY, PROGRESS_MI, type Anchor, type Candidate, type FillParams, type GapPlan,
} from "@/lib/route/fill";
import { gcMi, type LatLon } from "@/lib/route/geo";
import { anchor, cand, FLAT, rng, testMi as roadMi, testRoad } from "./helpers";

// These tests use synthetic coordinates, so they route on the test road double (1.2 x great circle, 50 mph).
const fillGap = (a: Anchor, b: Anchor, c: Candidate[], p: FillParams, used: Set<string>, runAtA?: number) => fillGapOn(a, b, c, p, used, testRoad, runAtA);
const fillTour = (anchors: Anchor[], c: Candidate[][], p: FillParams) => fillTourOn(anchors, c, p, testRoad);
const DEFAULT_DOW = DEFAULT_PARAMS.dowWeights;
// Hours and consecutive-show limits are switched off here unless a test is about them (see "drive hours and days off").
// Logic tests use the original 0.6 heat floor on hand-made candidates; the live default (0.94) is checked in rules tests.
const LOOSE = { maxDriveHours: 99, maxConsecutiveShows: 99, minAffinity: 0.6 } as const;
const P = (o: Partial<FillParams> = {}): FillParams => ({ ...DEFAULT_PARAMS, ...LOOSE, dowWeights: FLAT, ...o });
const fills = (g: GapPlan) => g.days.filter((d) => d.kind === "fill");
const status = (g: GapPlan, name: string) => g.considered.find((c) => c.name === name)?.status;

// A at 85°W, B at 75°W on 35°N: ~567 mi great-circle, ~680 road miles.
const A = anchor("A", -85, "2026-11-02");
const B = anchor("B", -75, "2026-11-08"); // 5 off days
const LINE: Candidate[] = [cand("C83", -83, 0.9), cand("C81_5", -81.5, 0.85), cand("C80", -80, 0.95), cand("C78_5", -78.5, 0.8), cand("C77", -77, 0.88)];

describe("date helpers", () => {
  it("adds days across month, year and DST boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02"); // US DST ends 2026-11-01
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-08", -1)).toBe("2026-03-07");
  });
  it("counts days between dates, including negative spans", () => {
    expect(daysBetween("2026-11-13", "2026-11-21")).toBe(8);
    expect(daysBetween("2026-11-21", "2026-11-13")).toBe(-8);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2); // DST start
  });
  it("knows the day of week", () => {
    expect(dowOf("2026-11-13")).toBe(5); // Friday
    expect(dowOf("2026-11-15")).toBe(0); // Sunday
  });
  it("validates real calendar dates", () => {
    expect(isIsoDate("2026-11-13")).toBe(true);
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("11/13/2026")).toBe(false);
    expect(isIsoDate("")).toBe(false);
  });
});

describe("assertParams", () => {
  it("accepts the defaults", () => expect(() => assertParams(DEFAULT_PARAMS)).not.toThrow());
  it.each([
    ["zero drive", { maxDriveMi: 0 }],
    ["affinity floor > 1", { minAffinity: 1.2 }],
    ["6 weights", { dowWeights: [1, 1, 1, 1, 1, 1] }],
    ["weight > 1", { dowWeights: [1, 1, 1, 1, 1, 1, 2] }],
    ["NaN weight", { dowWeights: [1, 1, 1, NaN, 1, 1, 1] }],
  ])("rejects %s", (_, o) => expect(() => assertParams(P(o))).toThrow(RangeError));
});

describe("fillGap: edge cases", () => {
  it("adjacent dates: nothing to fill, still feasible", () => {
    const g = fillGap(anchor("A", -85, "2026-11-02"), anchor("B", -80, "2026-11-03"), LINE, P(), new Set());
    expect(g).toMatchObject({ feasible: true, offDays: 0, filled: 0, days: [] });
  });
  it("same date or reversed anchors are infeasible", () => {
    expect(fillGap(A, { ...B, date: A.date }, LINE, P(), new Set())).toMatchObject({ feasible: false, offDays: 0 });
    const rev = fillGap(B, A, LINE, P(), new Set());
    expect(rev.feasible).toBe(false);
    expect(rev.note).toMatch(/not after/);
  });
  it("impossible gap: anchors too far apart for the days available -> all off days, explained", () => {
    const g = fillGap(A, { ...B, date: "2026-11-03" }, LINE, P({ maxDriveMi: 350 }), new Set()); // 680 road mi in 1 day
    expect(g.feasible).toBe(false);
    expect(g.note).toMatch(/over the 350 mi or 99 h per day limit/);
    const g2 = fillGap(A, { ...B, date: "2026-11-04" }, LINE, P({ maxDriveMi: 300 }), new Set()); // 680 > 600
    expect(g2.feasible).toBe(false);
    expect(g2.days.map((d) => d.kind)).toEqual(["off"]);
  });
  it("no candidates: every day off, with a note", () => {
    const g = fillGap(A, B, [], P(), new Set());
    expect(g.feasible).toBe(true);
    expect(g.days).toHaveLength(5);
    expect(g.days.every((d) => d.kind === "off")).toBe(true);
    expect(g.note).toMatch(/No candidate cities/);
  });
  it("all candidates removed by rules: note points to the filter", () => {
    const g = fillGap(A, B, [cand("nearA", -84.6, 0.99), cand("west", -90, 0.99)], P(), new Set());
    expect(g.filled).toBe(0);
    expect(g.note).toMatch(/removed by the touring rules/);
  });
  it("candidates that pass the filter but beat no off day: note says so", () => {
    const g = fillGap(A, B, [cand("meh", -80, 0.61)], P({ dowWeights: DEFAULT_DOW.map(() => 0.7) }), new Set()); // 0.61*0.7 < 0.45
    expect(g.filled).toBe(0);
    expect(status(g, "meh")).toBe("didn't fit schedule");
    expect(g.note).toMatch(/beats an off day/);
  });
});

describe("fillGap: touring rules", () => {
  it("fills off days along the line, in order, each hop within the drive limit", () => {
    const g = fillGap(A, B, LINE, P(), new Set());
    const f = fills(g);
    expect(f.length).toBeGreaterThan(0);
    const lons = f.map((d) => d.lon!);
    expect([...lons].sort((x, y) => x - y)).toEqual(lons); // west -> east, never back
    for (const d of f) expect(d.driveMi! / d.driveDays!).toBeLessThanOrEqual(350 + 0.5);
  });

  it("radius clause: removes cities within radiusMi of either anchor, with distance detail", () => {
    const g = fillGap(A, B, [...LINE, cand("nearA", -84.5, 0.99), cand("nearB", -75.6, 0.99)], P({ radiusMi: 60 }), new Set());
    expect(status(g, "nearA")).toBe("radius clause");
    expect(status(g, "nearB")).toBe("radius clause");
    expect(g.considered.find((c) => c.name === "nearA")?.detail).toMatch(/^28 mi from A$/);
    expect(fills(g).some((d) => d.city === "nearA" || d.city === "nearB")).toBe(false);
  });

  it("radius is configurable: a 20 mi clause lets the 28 mi city through", () => {
    const g = fillGap(A, B, [cand("nearA", -84.5, 0.99)], P({ radiusMi: 20 }), new Set());
    expect(status(g, "nearA")).not.toBe("radius clause");
  });

  it("off route: cities behind A, beyond B, or far off the line are removed", () => {
    const g = fillGap(A, B, [cand("behind", -87, 0.99), cand("beyond", -73, 0.99), cand("north", -80, 0.99, 44)], P(), new Set());
    for (const n of ["behind", "beyond", "north"]) expect(status(g, n)).toBe("off route / backtrack");
  });

  it("heat floor: weak cities are listed but never booked", () => {
    const g = fillGap(A, B, [cand("weak", -80, 0.59)], P({ minAffinity: 0.6 }), new Set());
    expect(status(g, "weak")).toBe("below heat floor");
    expect(g.filled).toBe(0);
  });

  it("used elsewhere: cities already on the tour are not reused (case-insensitive)", () => {
    const g = fillGap(A, B, LINE, P(), new Set(["c80"]));
    expect(status(g, "C80")).toBe("used elsewhere");
    expect(fills(g).some((d) => d.city === "C80")).toBe(false);
  });

  it("adds picked cities to the shared used set", () => {
    const used = new Set<string>();
    const g = fillGap(A, B, LINE, P(), used);
    for (const d of fills(g)) expect(used.has(d.city!.toLowerCase())).toBe(true);
  });

  it("no doubling back: never plays a city closer to A after one closer to B", () => {
    // Two strong cities, close in heat; only east-after-west is a legal order.
    const g = fillGap(A, B, [cand("east", -78, 0.9), cand("west", -82, 0.9)], P(), new Set());
    expect(fills(g).map((d) => d.city)).toEqual(["west", "east"]);
  });

  it("forward progress: a stop must get >= PROGRESS_MI closer to B than the previous stop", () => {
    // 0.3° of longitude ≈ 17 mi: less than PROGRESS_MI, so the two can't both be played (spacing aside).
    const g = fillGap(A, B, [cand("x1", -80, 0.9), cand("x2", -79.7, 0.9)], P({ spacingMi: 0 }), new Set());
    expect(fills(g)).toHaveLength(1);
    expect(PROGRESS_MI).toBeGreaterThan(17);
  });

  it("spacing: consecutive fills closer than spacingMi are not both booked", () => {
    const two = [cand("p", -80, 0.9), cand("q", -79.2, 0.9)]; // ~45 mi apart
    expect(fills(fillGap(A, B, two, P({ spacingMi: 50 }), new Set()))).toHaveLength(1);
    expect(fills(fillGap(A, B, two, P({ spacingMi: 40 }), new Set()))).toHaveLength(2);
  });

  it("drive limit: a tighter limit removes hops that would be too long", () => {
    // Only one far-off city reachable; with 200 mi/day and 1 day, a 400 road-mi hop from A is impossible.
    const a = anchor("A", -85, "2026-11-02"), b = anchor("B", -75, "2026-11-06"); // 3 off days, 680 mi total
    const c = [cand("mid", -80, 0.99)]; // ~340 road mi from A and from B
    const loose = fillGap(a, b, c, P({ maxDriveMi: 350 }), new Set());
    expect(fills(loose).map((d) => d.date)).toEqual(["2026-11-03"]);
    const tight = fillGap(a, b, c, P({ maxDriveMi: 200 }), new Set());
    // 340 mi needs 2 days at 200 mi/day, so "mid" can only be played on day 2.
    expect(fills(tight).map((d) => d.date)).toEqual(["2026-11-04"]);
    expect(fills(tight)[0]!.driveDays).toBe(2);
  });

  it("reachability: never books a fill from which B can't be reached in the days left", () => {
    // A 1-day hop to "late" is fine, but from there B is ~512 road mi away: needs 2 days at 300 mi/day.
    const a = anchor("A", -85, "2026-11-02"), b = anchor("B", -75, "2026-11-05"); // 2 off days
    const g = fillGap(a, b, [cand("late", -81.5, 0.99)], P({ maxDriveMi: 340 }), new Set());
    for (const d of fills(g)) {
      const left = daysBetween(d.date, b.date);
      expect(roadMi(d as LatLon, b)).toBeLessThanOrEqual(340 * left);
    }
  });

  it("prefers the stronger market when only one fits", () => {
    const g = fillGap(A, B, [cand("hot", -80, 0.95), cand("warm", -80.2, 0.75)], P(), new Set());
    expect(fills(g).map((d) => d.city)).toContain("hot");
    expect(status(g, "warm")).toBe("didn't fit schedule");
  });

  it("lists every candidate exactly once, sorted by heat", () => {
    const input = [...LINE, cand("weak", -80.3, 0.4), cand("nearA", -84.6, 0.9)];
    const g = fillGap(A, B, input, P(), new Set());
    expect(g.considered.map((c) => c.name).sort()).toEqual(input.map((c) => c.name).sort());
    const heats = g.considered.map((c) => c.affinity);
    expect([...heats].sort((x, y) => y - x)).toEqual(heats);
  });

  it("is deterministic", () => {
    expect(fillGap(A, B, LINE, P(), new Set())).toEqual(fillGap(A, B, LINE, P(), new Set()));
  });
});

describe("fillGap: night-of-week weights", () => {
  // 2026-11-01 is a Sunday, so the off days 11-02..11-07 are Mon..Sat.
  const a = anchor("A", -85, "2026-11-01"), b = anchor("B", -75, "2026-11-08");
  const only = (dow: number) => DEFAULT_DOW.map((_, i) => (i === dow ? 1 : 0));

  it("books a single city on the only night with demand", () => {
    for (const dow of [1, 3, 5, 6]) {
      const g = fillGap(a, b, [cand("mid", -80, 0.9)], P({ dowWeights: only(dow) }), new Set());
      expect(fills(g).map((d) => dowOf(d.date))).toEqual([dow]);
    }
  });
  it("leaves the gap open when no night clears the night floor", () => {
    const g = fillGap(a, b, LINE, P({ dowWeights: DEFAULT_DOW.map(() => 0.4) }), new Set()); // 0.95*0.4 < 0.45
    expect(g.filled).toBe(0);
  });
  it("records the weight used on each fill", () => {
    const g = fillGap(a, b, LINE, P({ dowWeights: DEFAULT_DOW }), new Set());
    for (const d of fills(g)) expect(d.dowWeight).toBe(DEFAULT_DOW[dowOf(d.date)]);
  });
  it("with default weights, a lone strong city goes on Fri/Sat rather than Monday", () => {
    const g = fillGap(a, b, [cand("mid", -80, 0.8)], P({ dowWeights: DEFAULT_DOW }), new Set());
    expect([5, 6]).toContain(dowOf(fills(g)[0]!.date));
  });
});

// ---------- Property tests: invariants + optimality against brute force ----------

function scoreOf(a: Anchor, b: Anchor, g: GapPlan, p: Required<FillParams>): number {
  let s = 0, prev: LatLon = a;
  for (const d of fills(g)) {
    s += d.affinity! * p.dowWeights[dowOf(d.date)]! - p.nightFloor - roadMi(prev, d as LatLon) * MILE_PENALTY;
    prev = d as LatLon;
  }
  return s;
}

/** Exhaustive search over every day assignment, with exactly the DP's rules. */
function bruteForce(a: Anchor, b: Anchor, cands: Candidate[], p: Required<FillParams>): number {
  const span = daysBetween(a.date, b.date), n = span - 1;
  const AB = gcMi(a, b);
  const pool = cands.filter((c) => gcMi(a, c) >= p.radiusMi && gcMi(c, b) >= p.radiusMi && gcMi(a, c) < AB && gcMi(c, b) < AB && c.affinity >= p.minAffinity);
  let best = 0;
  const rec = (d: number, prev: LatLon, prevDay: number, prevIsFill: boolean, usedIdx: Set<number>, score: number) => {
    if (d > n) { best = Math.max(best, score); return; }
    rec(d + 1, prev, prevDay, prevIsFill, usedIdx, score); // off day
    const w = p.dowWeights[dowOf(addDays(a.date, d))]!;
    pool.forEach((c, i) => {
      if (usedIdx.has(i)) return;
      const value = c.affinity * w - p.nightFloor;
      if (value <= 0) return;
      if (roadMi(c, b) > p.maxDriveMi * (span - d)) return;
      const hop = roadMi(prev, c);
      if (hop > p.maxDriveMi * (d - prevDay)) return;
      if (prevIsFill && gcMi(prev, c) < p.spacingMi) return;
      if (!(gcMi(c, b) < gcMi(prev, b) - PROGRESS_MI && gcMi(a, c) > gcMi(a, prev) + DEPART_MI)) return;
      rec(d + 1, c, d, true, new Set([...usedIdx, i]), score + value - hop * MILE_PENALTY);
    });
  };
  rec(1, a, 0, false, new Set(), 0);
  return best;
}

describe("fillGap: properties over random corridors", () => {
  it("always respects every touring rule (300 random cases)", () => {
    const r = rng(42);
    for (let k = 0; k < 300; k++) {
      const offDays = 1 + Math.floor(r() * 8);
      const a = anchor("A", -85, "2026-11-02"), b = anchor("B", -85 + 4 + r() * 8, addDays("2026-11-02", offDays + 1), 35 + (r() - 0.5) * 4);
      const cs = Array.from({ length: 4 + Math.floor(r() * 14) }, (_, i) => cand(`c${i}`, -86 + r() * 14, 0.4 + r() * 0.6, 32 + r() * 6));
      const p: Required<FillParams> = { ...DEFAULT_PARAMS, ...LOOSE, maxDriveMi: 200 + Math.floor(r() * 300), dowWeights: DEFAULT_DOW };
      const g = fillGap(a, b, cs, p, new Set());
      if (!g.feasible) { expect(roadMi(a, b)).toBeGreaterThan(p.maxDriveMi * (offDays + 1) - 1); continue; }

      const f = fills(g);
      expect(new Set(f.map((d) => d.city)).size).toBe(f.length); // each city once
      expect(g.days).toHaveLength(offDays);
      expect(g.days.map((d) => d.date)).toEqual(Array.from({ length: offDays }, (_, i) => addDays(a.date, i + 1)));
      let prev: LatLon = a, prevDate = a.date, prevIsFill = false;
      for (const d of f) {
        const here = d as LatLon;
        const days = daysBetween(prevDate, d.date);
        expect(roadMi(prev, here)).toBeLessThanOrEqual(p.maxDriveMi * days + 1e-6);
        expect(gcMi(here, b)).toBeLessThan(gcMi(prev, b) - PROGRESS_MI);
        expect(gcMi(a, here)).toBeGreaterThan(gcMi(a, prev) + DEPART_MI);
        expect(gcMi(a, here)).toBeGreaterThanOrEqual(p.radiusMi);
        expect(gcMi(here, b)).toBeGreaterThanOrEqual(p.radiusMi);
        if (prevIsFill) expect(gcMi(prev, here)).toBeGreaterThanOrEqual(p.spacingMi);
        expect(d.affinity!).toBeGreaterThanOrEqual(p.minAffinity);
        expect(d.affinity! * p.dowWeights[dowOf(d.date)]!).toBeGreaterThan(p.nightFloor);
        expect(d.driveDays).toBe(days);
        prev = here; prevDate = d.date; prevIsFill = true;
      }
      expect(roadMi(prev, b)).toBeLessThanOrEqual(p.maxDriveMi * daysBetween(prevDate, b.date) + 1e-6); // B reachable
    }
  });

  it("finds the optimal schedule (matches brute force on 150 small cases)", () => {
    const r = rng(7);
    for (let k = 0; k < 150; k++) {
      const offDays = 1 + Math.floor(r() * 4);
      const a = anchor("A", -85, "2026-11-04"), b = anchor("B", -78 + r() * 3, addDays("2026-11-04", offDays + 1));
      const cs = Array.from({ length: 2 + Math.floor(r() * 4) }, (_, i) => cand(`c${i}`, -84.5 + r() * 7, 0.55 + r() * 0.45, 34 + r() * 2));
      const p: Required<FillParams> = { ...DEFAULT_PARAMS, ...LOOSE, maxDriveMi: 200 + Math.floor(r() * 250), dowWeights: DEFAULT_DOW };
      const g = fillGap(a, b, cs, p, new Set());
      if (!g.feasible) continue;
      expect(scoreOf(a, b, g, p)).toBeCloseTo(bruteForce(a, b, cs, p), 9);
    }
  });
});

describe("fillTour", () => {
  const a1 = anchor("A1", -85, "2026-11-02"), a2 = anchor("A2", -75, "2026-11-08"), a3 = anchor("A3", -70, "2026-11-11");

  it("sorts anchors by date and builds a contiguous calendar", () => {
    const t = fillTour([a3, a1, a2], [LINE, []], P());
    expect(t.calendar[0]).toMatchObject({ kind: "anchor", city: "A1" });
    expect(t.calendar.at(-1)).toMatchObject({ kind: "anchor", city: "A3" });
    expect(t.calendar.map((d) => d.date)).toEqual(Array.from({ length: 10 }, (_, i) => addDays("2026-11-02", i)));
    expect(t.gaps.map((g) => `${g.from}>${g.to}`)).toEqual(["A1>A2", "A2>A3"]);
  });

  it("totals: off days before/after, fills, longest drive day, total miles", () => {
    const t = fillTour([a1, a2, a3], [LINE, []], P());
    expect(t.offBefore).toBe(5 + 2);
    expect(t.fills).toBe(t.gaps.reduce((s, g) => s + g.filled, 0));
    expect(t.offAfter).toBe(t.offBefore - t.fills);
    const legs = t.calendar.filter((d) => d.driveMi !== undefined);
    expect(t.totalMi).toBe(legs.reduce((s, d) => s + d.driveMi!, 0));
    expect(t.maxDayDrive).toBe(Math.max(...legs.map((d) => Math.round(d.driveMi! / Math.max(1, d.driveDays!)))));
    expect(t.maxDayDrive).toBeLessThanOrEqual(350);
  });

  it("anchor arrival drive is measured from the last fill of the gap", () => {
    const t = fillTour([a1, a2], [LINE], P());
    const lastFill = fills(t.gaps[0]!).at(-1)!;
    const arrive = t.calendar.at(-1)!;
    expect(arrive.driveMi).toBe(Math.round(roadMi(lastFill as LatLon, a2)));
    expect(arrive.driveDays).toBe(daysBetween(lastFill.date, a2.date));
  });

  it("anchor arrival with no fills is the direct drive", () => {
    const t = fillTour([a1, a2], [[]], P());
    expect(t.calendar.at(-1)).toMatchObject({ driveMi: Math.round(roadMi(a1, a2)), driveDays: 6 });
  });

  it("never reuses a city across gaps or an anchor city as a fill", () => {
    const shared = [cand("A2", -80, 0.99), cand("Both", -77.5, 0.99, 35.2)];
    const t = fillTour([a1, a2, anchor("A3", -70, "2026-11-14")], [shared, [cand("Both", -72.5, 0.99)]], P());
    const names = t.calendar.filter((d) => d.kind === "fill").map((d) => d.city);
    expect(names).not.toContain("A2");
    expect(new Set(names).size).toBe(names.length);
  });

  it("missing candidate lists are treated as empty", () => {
    const t = fillTour([a1, a2, a3], [], P());
    expect(t.fills).toBe(0);
    expect(t.gaps.every((g) => g.note?.includes("No candidate cities"))).toBe(true);
  });

  it("single anchor: no gaps", () => {
    const t = fillTour([a1], [], P());
    expect(t).toMatchObject({ gaps: [], offBefore: 0, fills: 0, totalMi: 0 });
  });

  it("rejects invalid params", () => expect(() => fillTour([a1, a2], [], P({ dowWeights: [1] }))).toThrow(RangeError));
});

describe("drive hours and days off (cited touring rules)", () => {
  // Same geometry as above (A -85, B -75 on 35N), now with the hours and consecutive-show limits switched on.
  it("rejects a hop that fits the mile limit but not the hours limit", () => {
    // A road double where every mile is slow: 20 mph, so a 200-mile hop takes 10 h.
    const slow = (a: LatLon, b: LatLon) => ({ mi: roadMi(a, b), hours: roadMi(a, b) / 20 });
    const p = P({ maxDriveMi: 700, maxDriveHours: 7.5 });
    const fast = fillGapOn(A, B, LINE, p, new Set(), testRoad);
    const crawl = fillGapOn(A, B, LINE, p, new Set(), slow);
    expect(fills(fast).length).toBeGreaterThan(0);
    for (const d of fills(crawl)) expect(d.driveHours!).toBeLessThanOrEqual(7.5 * d.driveDays! + 0.05);
    expect(fills(crawl).length).toBeLessThan(fills(fast).length + 1);
  });

  it("never schedules more consecutive shows than the limit, anchors included", () => {
    const many = Array.from({ length: 9 }, (_, i) => cand(`m${i}`, -84 + i, 0.95));
    const b = anchor("B", -74, "2026-11-12"); // 9 off days
    for (const limit of [1, 2, 3, 4, 6]) {
      const g = fillGap(A, b, many, P({ maxDriveMi: 400, maxConsecutiveShows: limit }), new Set());
      let run = 1, longest = 1; // A is a show
      for (const d of g.days) { run = d.kind === "fill" ? run + 1 : 0; longest = Math.max(longest, run); }
      run += 1; longest = Math.max(longest, run); // B is a show
      expect(longest).toBeLessThanOrEqual(limit === 1 ? 2 : limit); // with limit 1 the anchors alone may be adjacent only via an off day
      for (const d of fills(g)) expect(d.run!).toBeLessThanOrEqual(limit);
    }
  });

  it("reports the longest run and drive hours in the tour totals", () => {
    const t = fillTour([A, B], [LINE], P({ maxConsecutiveShows: 3 }));
    expect(t.longestRun).toBeLessThanOrEqual(3);
    expect(t.maxDayHours).toBeGreaterThan(0);
    expect(t.totalHours).toBeCloseTo(t.calendar.reduce((s, d) => s + (d.driveHours ?? 0), 0), 0);
  });

  it("marks candidates the road network can't reach", () => {
    const holey = (a: LatLon, b: LatLon) => (a.lon === -80 || b.lon === -80 ? undefined : testRoad(a, b));
    const g = fillGapOn(A, B, LINE, P(), new Set(), holey);
    expect(status(g, "C80")).toBe("no road route");
    expect(fills(g).some((d) => d.city === "C80")).toBe(false);
  });
});
