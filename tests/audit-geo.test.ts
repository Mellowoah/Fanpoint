import { describe, expect, it } from "vitest";
import { auditSequence as auditOn, DEFAULT_PARAMS } from "@/lib/route/fill";
import { corridor, gcMi, inRing, LOWER48_WKT, parseWktPolygon, ringToWkt } from "@/lib/route/geo";
import { findCity, US_CITIES } from "@/lib/route/cities";
import { packCells, readCities } from "@/lib/qloo/heat";
import type { HeatCell } from "@/lib/qloo/types";
import { anchor, testRoad } from "./helpers";

const auditSequence = (...a: [Parameters<typeof auditOn>[0], Parameters<typeof auditOn>[1], Parameters<typeof auditOn>[2]]) => auditOn(...a, testRoad);

describe("geo", () => {
  it("great-circle distance matches known city pairs (±2%)", () => {
    const ny = findCity("New York")!, la = findCity("Los Angeles")!, phl = findCity("Philadelphia")!;
    expect(gcMi(ny, la)).toBeGreaterThan(2400); expect(gcMi(ny, la)).toBeLessThan(2500); // ~2,450 mi
    expect(gcMi(ny, phl)).toBeGreaterThan(78); expect(gcMi(ny, phl)).toBeLessThan(82); // ~80 mi
    expect(gcMi(ny, ny)).toBe(0);
    expect(gcMi(ny, la)).toBeCloseTo(gcMi(la, ny), 9);
  });
  it("corridor contains both endpoints and the midpoint, not far-off points; WKT round-trips", () => {
    const a = findCity("New York")!, b = findCity("Durham")!;
    const { ring, wkt } = corridor(a, b, 90);
    expect(ring).toHaveLength(4);
    expect(inRing(a, ring)).toBe(true);
    expect(inRing(b, ring)).toBe(true);
    expect(inRing({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 }, ring)).toBe(true);
    expect(inRing(findCity("Chicago")!, ring)).toBe(false);
    expect(wkt.startsWith("POLYGON((")).toBe(true);
    const back = parseWktPolygon(wkt)!;
    expect(back).toHaveLength(5); // closed
    expect(back[0]).toEqual(back[4]);
    expect(back.slice(0, 4)).toEqual(ring);
  });
  it("lower-48 WKT is a closed lon-lat rectangle", () => {
    expect(LOWER48_WKT).toBe("POLYGON((-125 24.5, -125 49.5, -66.5 49.5, -66.5 24.5, -125 24.5))");
    expect(ringToWkt([])).toBe("POLYGON(())");
  });
  it("parseWktPolygon rejects malformed input instead of producing NaN points", () => {
    expect(parseWktPolygon("")).toBeNull();
    expect(parseWktPolygon("POINT(1 2)")).toBeNull();
    expect(parseWktPolygon("POLYGON((1 2, a b, 3 4, 1 2))")).toBeNull();
    expect(parseWktPolygon("POLYGON((1 2 3, 2 3, 3 4, 1 2))")).toBeNull();
    expect(parseWktPolygon("POLYGON((1 2, 3 4))")).toBeNull();
    expect(parseWktPolygon("polygon ((0 0, 0 1, 1 1, 0 0))")).toHaveLength(4);
  });
  it("touring-city list: unique names, valid coordinates, lookup ignores case and ', ST' suffix", () => {
    expect(new Set(US_CITIES.map((c) => c.name)).size).toBe(US_CITIES.length);
    for (const c of US_CITIES) { expect(c.lat).toBeGreaterThan(24); expect(c.lat).toBeLessThan(50); expect(c.lon).toBeLessThan(-66); expect(c.lon).toBeGreaterThan(-125); }
    expect(findCity("  durham, NC ")?.name).toBe("Durham");
    expect(findCity("Atlantis")).toBeUndefined();
  });
});

describe("readCities (heatmap cells -> touring cities)", () => {
  const cell = (lat: number, lon: number, affinity: number): HeatCell => ({ lat, lon, affinity, mock: false });
  const phl = findCity("Philadelphia")!;
  it("takes the strongest cell within the radius and reports its distance", () => {
    const out = readCities([cell(phl.lat, phl.lon, 0.7), cell(phl.lat + 0.2, phl.lon, 0.9), cell(phl.lat + 1, phl.lon, 0.99)], [phl], 25);
    expect(out).toEqual([expect.objectContaining({ name: "Philadelphia", affinity: 0.9, cellDistMi: 14 })]);
  });
  it("skips cities with no cell in range (never guesses)", () => {
    expect(readCities([cell(phl.lat + 1, phl.lon, 0.99)], [phl], 25)).toEqual([]);
  });
  it("honours radii larger than the old fixed lat/lon pre-filter box", () => {
    // 1.1° of longitude at Philadelphia's latitude ≈ 58 mi: beyond the old fixed 0.8° box.
    const out = readCities([cell(phl.lat, phl.lon + 1.1, 0.8)], [phl], 60);
    expect(out).toHaveLength(1);
  });
  it("filters by ring and sorts strongest first", () => {
    const bal = findCity("Baltimore")!, chi = findCity("Chicago")!;
    const { ring } = corridor(phl, findCity("Richmond")!, 40);
    const out = readCities([cell(phl.lat, phl.lon, 0.7), cell(bal.lat, bal.lon, 0.9), cell(chi.lat, chi.lon, 1)], [phl, bal, chi], 25, ring);
    expect(out.map((c) => c.name)).toEqual(["Baltimore", "Philadelphia"]);
  });
  it("packCells keeps the strongest N as [lat, lon, affinity]", () => {
    const cells = [cell(1, 1, 0.2), cell(2, 2, 0.9), cell(3, 3, 0.5)];
    expect(packCells(cells, 2)).toEqual([[2, 2, 0.9], [3, 3, 0.5]]);
    expect(cells[0]!.affinity).toBe(0.2); // input not mutated
  });
});

describe("auditSequence (plain-AI answers)", () => {
  const A = anchor("A", -85, "2026-11-02"), B = anchor("B", -75, "2026-11-08");
  const stop = (city: string, lon: number, date: string, lat = 35) => ({ city, lat, lon, date });
  const P = { ...DEFAULT_PARAMS, maxDriveMi: 350, maxDriveHours: 99 };

  it("passes a clean forward route", () => {
    const rows = auditSequence([A, B], [stop("x", -82, "2026-11-04"), stop("y", -78.5, "2026-11-06")], P);
    expect(rows.map((r) => r.city)).toEqual(["A", "x", "y", "B"]);
    for (const r of rows.filter((r) => !r.anchor)) expect(r).toMatchObject({ overDrive: false, doublesBack: false, radiusConflict: undefined, dateConflict: undefined });
    expect(rows[0]).toMatchObject({ anchor: true });
    expect(rows[0]!.driveMi).toBeUndefined();
  });
  it("flags over-max-drive days", () => {
    const rows = auditSequence([A, B], [stop("far", -79, "2026-11-03")], P); // ~408 road mi in 1 day
    expect(rows.find((r) => r.city === "far")).toMatchObject({ overDrive: true, perDay: expect.any(Number) });
  });
  it("flags doubling back", () => {
    const rows = auditSequence([A, B], [stop("x", -80, "2026-11-04"), stop("back", -82.5, "2026-11-05")], P);
    expect(rows.find((r) => r.city === "back")?.doublesBack).toBe(true);
    expect(rows.find((r) => r.city === "x")?.doublesBack).toBe(false);
  });
  it("flags radius-clause conflicts with the anchor's name", () => {
    const rows = auditSequence([A, B], [stop("close", -75.5, "2026-11-07")], P);
    expect(rows.find((r) => r.city === "close")?.radiusConflict).toBe("B");
  });
  it("flags stops that are not on an off day", () => {
    const rows = auditSequence([A, B], [stop("before", -84, "2026-11-01"), stop("onB", -76, "2026-11-08"), stop("d1", -82, "2026-11-04"), stop("d2", -81, "2026-11-04"), stop("after", -74, "2026-11-09")], P);
    const by = (c: string) => rows.find((r) => r.city === c)?.dateConflict;
    expect(by("before")).toBe("outside the tour dates");
    expect(by("after")).toBe("outside the tour dates");
    expect(by("onB")).toBe("same day as an anchor");
    expect(by("d1")).toBeUndefined();
    expect(by("d2")).toBe("two shows on one day");
  });
  it("handles no anchors without throwing", () => {
    const rows = auditSequence([], [stop("x", -80, "2026-11-04")], P);
    expect(rows[0]?.dateConflict).toBe("outside the tour dates");
  });
});
