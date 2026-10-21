/** With Qloo / Without Qloo: identical hard-filtered candidates, two fixed orderings, exact score lines, co-head fallback. */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { byProxy, byQloo, eligibleCities, PROXY_DESCRIPTION, rankGaps, type HeatRead, type RankedCity } from "@/lib/route/rank";
import { COHEAD_WITHOUT_QLOO_LINE, scoreLine, WITHOUT_QLOO_LINE } from "@/lib/route/score-line";
import { DEFAULT_PARAMS, screen, type Anchor } from "@/lib/route/fill";
import { MARKETS } from "@/lib/data/markets";
import { corridor, gcMi, inRing } from "@/lib/route/geo";
import { osrmRoads } from "@/lib/route/road";
import { US_CITIES, findCity } from "@/lib/route/cities";
import { resolveAnchors, runAgent } from "@/lib/agent/run";
import { RULE_VALUES } from "@/lib/touring/rules";
import { MockQlooClient } from "@/lib/qloo/mock-client";
import { MockLlmClient } from "@/lib/llm/mock";
import type { AgentEvent, CoheadPlan, FillPlan } from "@/lib/agent/types";
import { CoheadWithout } from "@/components/CoheadView";
import { rng } from "./helpers";

const road = osrmRoads().leg;
const anchors: Anchor[] = resolveAnchors({ anchors: [{ city: "New York", date: "2026-11-13" }, { city: "Durham", date: "2026-11-21" }, { city: "Atlanta", date: "2026-11-28" }] });
const rings = anchors.slice(0, -1).map((a, i) => corridor(a, anchors[i + 1]!, RULE_VALUES.corridorBufferMi).ring);
const P = { ...DEFAULT_PARAMS };
const randomHeat = (seed: number) => { const r = rng(seed); return rings.map(() => new Map<string, HeatRead>(US_CITIES.map((c) => [c.id, { affinity: +r().toFixed(3), popularity: r() }]))); };
const ids = (l: RankedCity[]) => l.map((c) => c.id);
async function collect(gen: AsyncGenerator<AgentEvent>) { const ev: AgentEvent[] = []; for await (const e of gen) ev.push(e); return ev; }
const result = <T,>(ev: AgentEvent[]) => ev.find((e): e is Extract<AgentEvent, { type: "result" }> => e.type === "result")?.plan as T;

describe("hard filters are identical in both modes", () => {
  it("both lists hold exactly the same cities, whatever the Qloo scores are", () => {
    const a = rankGaps(anchors, rings, randomHeat(1), US_CITIES, P, road);
    const b = rankGaps(anchors, rings, randomHeat(2), US_CITIES, P, road);
    const none = rankGaps(anchors, rings, [], US_CITIES, P, road);
    for (let k = 0; k < a.length; k++) {
      const set = [...ids(a[k]!.withQloo)].sort();
      expect(set.length).toBeGreaterThan(5);
      expect([...ids(a[k]!.withoutQloo)].sort()).toEqual(set);
      expect([...ids(b[k]!.withQloo)].sort()).toEqual(set); // different scores, same candidates
      expect([...ids(none[k]!.withQloo)].sort()).toEqual(set); // no Qloo data at all, same candidates
      expect(a[k]!.eligible).toBe(set.length);
    }
  });
  it("the Without Qloo order ignores Qloo entirely", () => {
    const a = rankGaps(anchors, rings, randomHeat(3), US_CITIES, P, road), b = rankGaps(anchors, rings, [], US_CITIES, P, road);
    expect(a.map((g) => ids(g.withoutQloo))).toEqual(b.map((g) => ids(g.withoutQloo)));
    for (const g of a) for (const c of g.withoutQloo) { expect(c.affinity).toBeUndefined(); expect(c.popularity).toBeUndefined(); }
  });
  it("applies the existing rules: anchors, radius clause, between the anchors, OSRM drive limits; not the heat floor", () => {
    const [A, B] = anchors as [Anchor, Anchor];
    const { list, inCorridor } = eligibleCities(A, B, rings[0]!, US_CITIES, P, road, new Set(anchors.map((x) => x.city.toLowerCase())));
    expect(inCorridor).toBeGreaterThan(list.length);
    const AB = gcMi(A, B);
    for (const c of list) {
      expect(c.name).not.toBe("New York");
      expect(gcMi(A, c)).toBeGreaterThanOrEqual(P.radiusMi);
      expect(gcMi(c, B)).toBeGreaterThanOrEqual(P.radiusMi);
      expect(gcMi(A, c) < AB && gcMi(c, B) < AB).toBe(true);
      expect(road(A, c)).toBeTruthy();
    }
    // Every city is at least the Census market floor (built into the universe).
    for (const c of list) expect(findCity(c.name)!.metro.population).toBeGreaterThanOrEqual(200_000);
    // Low affinity does not remove a city (the heat floor needs Qloo, so it is not a hard filter).
    const low = rankGaps(anchors, rings, rings.map(() => new Map(US_CITIES.map((c) => [c.id, { affinity: 0.01 }]))), US_CITIES, P, road);
    expect(low[0]!.eligible).toBe(list.length);
  });
  it("tighter drive limits remove cities in both modes alike", () => {
    // A 3-day hop New York -> Durham: under 200 mi / 4 h a day only cities near the middle can be played.
    const short = [anchors[0]!, { ...anchors[1]!, date: "2026-11-16" }];
    const tight = rankGaps(short, rings, randomHeat(4), US_CITIES, { ...P, maxDriveMi: 200, maxDriveHours: 4 }, road);
    const loose = rankGaps(short, rings, randomHeat(4), US_CITIES, { ...P, maxDriveMi: 700, maxDriveHours: 10 }, road);
    expect(tight[0]!.note).toBeUndefined();
    expect(tight[0]!.eligible).toBeLessThan(loose[0]!.eligible);
    expect([...ids(tight[0]!.withQloo)].sort()).toEqual([...ids(tight[0]!.withoutQloo)].sort());
  });
  it("an infeasible or zero-off-day gap yields no candidates and a note", () => {
    const [A] = anchors as [Anchor];
    const next = { ...anchors[1]!, date: "2026-11-14" };
    expect(eligibleCities(A, next, rings[0]!, US_CITIES, P, road, new Set()).note).toMatch(/No off days/);
    const far = { ...findCity("Atlanta")!, city: "Atlanta", date: "2026-11-15" } as Anchor;
    expect(eligibleCities(A, far, rings[0]!, US_CITIES, P, road, new Set()).note).toMatch(/drive limits/);
  });
});

describe("real venue required (OSM venue count)", () => {
  const zero = MARKETS.filter((m) => m.venues.total === 0);
  it("the rule is registered with its OSM source", () => {
    expect(RULE_VALUES.minVenues).toBe(1);
    expect(zero.map((m) => m.id).sort()).toEqual(["crestview-fl", "lake-havasu-city-az", "lenoir-nc", "warner-robins-ga"]);
  });
  it("screen() removes a zero-venue market and keeps a market with venues, by id or by name", () => {
    const [A, B] = anchors as [Anchor, Anchor];
    const lenoir = findCity("Lenoir")!;
    const at = { lat: (A.lat + B.lat) / 2, lon: (A.lon + B.lon) / 2 }; // between the anchors, so only the venue rule can fire
    expect(screen({ id: lenoir.id, name: lenoir.name, ...at, affinity: 1 }, A, B, P, new Set(), road)?.status).toBe("no mapped venue");
    expect(screen({ name: "Lenoir", ...at, affinity: 1 }, A, B, P, new Set(), road, false)?.status).toBe("no mapped venue");
    const rich = findCity("Richmond, VA")!;
    expect(screen({ id: rich.id, name: rich.name, ...at, affinity: 1 }, A, B, P, new Set(), road)?.status).not.toBe("no mapped venue");
    expect(screen({ name: "synthetic point", ...at, affinity: 1 }, A, B, P, new Set(), road)?.status).not.toBe("no mapped venue"); // not a market: not judged
  });
  it("zero-venue markets are in neither list, in either mode, even with top Qloo affinity", () => {
    const hot = rings.map(() => new Map(US_CITIES.map((c) => [c.id, { affinity: c.venues.total === 0 ? 1 : 0.5 }])));
    const r = rankGaps(anchors, rings, hot, US_CITIES, P, road);
    const inCorridor = US_CITIES.filter((c) => c.venues.total === 0 && rings.some((ring) => inRing(c, ring)));
    expect(inCorridor.map((c) => c.id)).toContain("lenoir-nc"); // the demo corridor does contain one
    for (const g of r) for (const c of [...g.withQloo, ...g.withoutQloo]) expect(c.venues).toBeGreaterThanOrEqual(1);
  });
  it("the routed demo never schedules a zero-venue market and the filter table says why", async () => {
    const plan = result<FillPlan>(await collect(runAgent({ task: "fill", artist: "Marigold Static", maxDriveMi: 350, minAffinity: 0.6,
      anchors: [{ city: "New York", date: "2026-11-13" }, { city: "Durham", date: "2026-11-21" }, { city: "Atlanta", date: "2026-11-28" }] }, { qloo: new MockQlooClient([0, 0]), llm: new MockLlmClient(0) })));
    for (const s of plan.stops) expect(findCity(s.city)!.venues.total).toBeGreaterThanOrEqual(1);
    const rows = plan.result.gaps.flatMap((g) => g.considered).filter((c) => c.status === "no mapped venue");
    expect(rows.map((c) => c.name)).toContain("Lenoir");
  });
});

describe("sort order per mode", () => {
  const c = (id: string, population: number, venues: number, affinity?: number, popularity?: number): RankedCity => ({ id, name: id, region: "XX", lat: 0, lon: 0, population, venues, affinity, popularity });
  it("With Qloo: affinity desc, Qloo popularity breaks ties, no reading last", () => {
    const l = [c("a", 9e6, 99, 0.5), c("b", 1, 0, 0.9), c("c", 5, 5), c("d", 2, 2, 0.9, 0.8), c("e", 3, 3, 0.7)].sort(byQloo);
    expect(ids(l)).toEqual(["d", "b", "e", "a", "c"]);
  });
  it("Without Qloo: Census population desc, OSM venues break ties, then id", () => {
    const l = [c("a", 100, 1, 0.99), c("b", 300, 0), c("c", 100, 7), c("d", 100, 7)].sort(byProxy);
    expect(ids(l)).toEqual(["b", "c", "d", "a"]);
    expect(PROXY_DESCRIPTION).toMatch(/population.*venues/);
  });
  it("lists are sorted as specified on real data", () => {
    for (const g of rankGaps(anchors, rings, randomHeat(5), US_CITIES, P, road)) {
      for (let i = 1; i < g.withQloo.length; i++) expect(byQloo(g.withQloo[i - 1]!, g.withQloo[i]!)).toBeLessThanOrEqual(0);
      for (let i = 1; i < g.withoutQloo.length; i++) expect(g.withoutQloo[i - 1]!.population).toBeGreaterThanOrEqual(g.withoutQloo[i]!.population);
    }
  });
});

describe("score lines", () => {
  it("uses the exact wording", () => {
    expect(scoreLine("with", 0.834)).toBe("Qloo affinity: 0.83 | Ranked by affinity after filters");
    expect(scoreLine("with", 1)).toBe("Qloo affinity: 1.00 | Ranked by affinity after filters");
    expect(scoreLine("with")).toBe("Qloo affinity: no reading | Ranked by affinity after filters");
    expect(scoreLine("without", 0.9)).toBe("No affinity signal | Ranked by population/venues only");
    expect(WITHOUT_QLOO_LINE).toBe("No affinity signal | Ranked by population/venues only");
  });
});

describe("demo (mock Qloo): the toggle changes the outcome", () => {
  it("fill: ranked lists ship with the plan and the top cities differ between modes", async () => {
    const plan = result<FillPlan>(await collect(runAgent({ task: "fill", artist: "Marigold Static", maxDriveMi: 350, minAffinity: 0.6,
      anchors: [{ city: "New York", date: "2026-11-13" }, { city: "Durham", date: "2026-11-21" }, { city: "Atlanta", date: "2026-11-28" }] }, { qloo: new MockQlooClient([0, 0]), llm: new MockLlmClient(0) })));
    expect(plan.ranked).toHaveLength(2);
    for (const g of plan.ranked) {
      expect(g.withQloo[0]!.affinity).toBeDefined();
      expect(ids(g.withQloo.slice(0, 5))).not.toEqual(ids(g.withoutQloo.slice(0, 5)));
    }
    // Every routed fill passed the same hard filters (it is in the shared candidate set).
    const all = new Set(plan.ranked.flatMap((g) => g.withQloo.map((c) => c.name)));
    for (const s of plan.stops) expect(all.has(s.city)).toBe(true);
  });
  it("co-headliner: With Qloo ranks by complementarity; Without Qloo is unranked with a no-signal note", async () => {
    const plan = result<CoheadPlan>(await collect(runAgent({ task: "cohead", artist: "Marigold Static", partner: "Saltwater Hymnal (mock)" }, { qloo: new MockQlooClient([0, 0]), llm: new MockLlmClient(0) })));
    expect(plan.peers.some((p) => p.picked)).toBe(true);
    const html = renderToStaticMarkup(createElement(CoheadWithout, { plan }));
    expect(html).toContain("No fan signal, so no pairing can be judged.");
    expect(html.split(COHEAD_WITHOUT_QLOO_LINE.replace("'", "&#x27;")).length - 1).toBe(plan.peers.length);
    expect(html).not.toContain(">recommended<"); // no recommended badge
    const names = [...plan.peers].map((p) => p.entity.name).sort((a, b) => a.localeCompare(b));
    const pos = names.map((n) => html.indexOf(n.replace("&", "&amp;")));
    expect([...pos].sort((a, b) => a - b)).toEqual(pos); // alphabetical, not by score
  });
});
