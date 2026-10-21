/** The committed datasets (Census + OSM markets, OSRM road matrix) and the cited rules registry. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import rawMatrix from "@/lib/data/road-matrix.json";
import { findMarket, MARKETS, MARKETS_META, marketById } from "@/lib/data/markets";
import { buildRoadMatrix, decodeU16, osrmRoads } from "@/lib/route/road";
import { gcMi } from "@/lib/route/geo";
import { ADJUSTABLE, RULES, RULE_VALUES, type RuleKey } from "@/lib/touring/rules";
import { RuleOverrides } from "@/lib/api/plan-request";

describe("market universe (Census + OSM)", () => {
  it("has unique ids and display names, real populations and lower-48 coordinates", () => {
    expect(MARKETS.length).toBeGreaterThan(350);
    expect(new Set(MARKETS.map((m) => m.id)).size).toBe(MARKETS.length);
    expect(new Set(MARKETS.map((m) => m.name)).size).toBe(MARKETS.length);
    for (const m of MARKETS) {
      expect(m.population).toBeGreaterThan(0);
      expect(m.metro.population).toBeGreaterThanOrEqual(200_000);
      expect(m.metro.population).toBeGreaterThanOrEqual(m.population);
      expect(m.lat).toBeGreaterThan(24); expect(m.lat).toBeLessThan(50);
      expect(m.lon).toBeGreaterThan(-125); expect(m.lon).toBeLessThan(-66);
      expect(m.venues.total).toBe(m.venues.music_venue + m.venues.nightclub + m.venues.theatre + m.venues.live_music);
      expect(m.geoid).toMatch(/^\d{7}$/);
    }
  });
  it("matches published figures for well-known cities", () => {
    const ny = findMarket("New York")!;
    expect(ny.population).toBeGreaterThan(8_000_000);
    expect(ny.metro.title).toMatch(/^New York-Newark-Jersey City/);
    expect(findMarket("Nashville")?.censusName).toBe("Nashville-Davidson");
    expect(findMarket("Chicago")!.venues.total).toBeGreaterThan(50);
  });
  it("resolves display names, ids, 'City ST' and bare shared names (largest metro)", () => {
    expect(findMarket("Portland")?.state).toBe("OR");
    expect(findMarket("Portland, ME")?.state).toBe("ME");
    expect(findMarket("portland me")?.state).toBe("ME");
    expect(findMarket("portland-me")?.state).toBe("ME");
    expect(findMarket("Kansas City")?.state).toBe("MO");
    expect(findMarket("St. Louis")?.id).toBe(findMarket("st louis")?.id);
    expect(findMarket("Atlantis")).toBeUndefined();
    expect(marketById("chicago-il")?.name).toBe("Chicago");
  });
  it("records where every number came from", () => {
    expect(Object.keys(MARKETS_META.sources)).toEqual(expect.arrayContaining(["principalCities", "metroPopulation", "placePopulation", "coordinates", "venues"]));
    expect(MARKETS_META.sources.venues).toMatch(/ODbL/);
  });
});

describe("OSRM road matrix", () => {
  const roads = osrmRoads();
  it("covers every market, both directions", () => {
    expect([...roads.ids].sort()).toEqual(MARKETS.map((m) => m.id).sort());
  });
  it("matches known drives (OSRM car profile)", () => {
    const leg = (a: string, b: string) => roads.legById(findMarket(a)!.id, findMarket(b)!.id)!;
    expect(leg("Boston", "New York").mi).toBeGreaterThan(200); expect(leg("Boston", "New York").mi).toBeLessThan(230);
    expect(leg("New York", "Philadelphia").mi).toBeGreaterThan(85); expect(leg("New York", "Philadelphia").mi).toBeLessThan(105);
    expect(leg("Los Angeles", "San Francisco").mi).toBeGreaterThan(370); expect(leg("Los Angeles", "San Francisco").mi).toBeLessThan(440);
    expect(leg("Atlanta", "Nashville").hours).toBeGreaterThan(3.5); expect(leg("Atlanta", "Nashville").hours).toBeLessThan(5.5);
  });
  it("is never shorter than the straight line, and close to symmetric", () => {
    let asym = 0;
    for (const a of MARKETS) for (const b of MARKETS) {
      if (a.id === b.id) continue;
      const l = roads.legById(a.id, b.id);
      expect(l, `${a.id}->${b.id}`).toBeDefined();
      expect(l!.mi).toBeGreaterThanOrEqual(Math.floor(gcMi(a, b) * 0.97) - 1);
      const back = roads.legById(b.id, a.id)!;
      if (Math.abs(l!.mi - back.mi) > Math.max(15, 0.1 * l!.mi)) asym++;
    }
    expect(asym / (MARKETS.length * (MARKETS.length - 1))).toBeLessThan(0.01);
  });
  it("needs ids: unknown places have no route rather than a guessed one", () => {
    expect(roads.leg({ lat: 40, lon: -74 }, { lat: 41, lon: -75 })).toBeUndefined();
    expect(roads.legById("nowhere", "chicago-il")).toBeUndefined();
  });
  it("decodes little-endian uint16 and rejects a matrix of the wrong size", () => {
    expect([...decodeU16(Buffer.from([1, 0, 0, 1, 255, 255]).toString("base64"))]).toEqual([1, 256, 65535]);
    expect(() => buildRoadMatrix({ ...rawMatrix, ids: rawMatrix.ids.slice(1) })).toThrow(/expected/);
  });
});

describe("touring rules registry", () => {
  const sources = readFileSync("docs/SOURCES.md", "utf8");
  it("every rule is documented in docs/SOURCES.md", () => {
    for (const k of Object.keys(RULES)) expect(sources, k).toContain(`\`${k}\``);
  });
  it("sourced and adapted rules cite at least one https source; assumptions say so", () => {
    for (const [k, r] of Object.entries(RULES)) {
      if (r.kind === "sourced" || r.kind === "adapted") {
        expect(r.sources.length, k).toBeGreaterThan(0);
        for (const s of r.sources) expect(s.url, k).toMatch(/^https?:\/\//);
      }
      expect(r.why.length, k).toBeGreaterThan(20);
    }
  });
  it("only adjustable rules can be overridden through the API, and their defaults are inside the allowed range", () => {
    const keys = Object.keys(RuleOverrides.shape) as RuleKey[];
    for (const k of keys) expect(RULES[k], k).toBeDefined();
    const defaults = Object.fromEntries(keys.map((k) => [k, RULE_VALUES[k]]));
    expect(RuleOverrides.safeParse(defaults).success).toBe(true);
    expect(RuleOverrides.safeParse({ maxDriveHours: 14 }).success).toBe(false);
    expect(RuleOverrides.safeParse({ spacingMi: 1 }).success).toBe(false); // strict: not user-adjustable
    for (const k of ADJUSTABLE) expect(["maxDriveMi", "minAffinity", ...keys]).toContain(k);
  });
});
