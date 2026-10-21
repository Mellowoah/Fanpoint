import { describe, expect, it } from "vitest";
import { nameKey, Registry, Tools } from "@/lib/agent/tools";
import { MockQlooClient, percentileAffinity } from "@/lib/qloo/mock-client";
import type { HeatCell, QlooClient, QlooRawEntity } from "@/lib/qloo/types";
import { RULES } from "@/lib/touring/rules";
import { inRing, LOWER48_RING, LOWER48_WKT } from "@/lib/route/geo";
import { US_CITIES } from "@/lib/route/cities";

/** QlooClient double whose /search answers like live Qloo: its closest matches, whatever the query. */
function fuzzySearch(results: string[]): QlooClient {
  const ent = (name: string): QlooRawEntity => ({ name, entity_id: `id-${nameKey(name).replace(/ /g, "-")}`, types: ["urn:entity:artist"], popularity: 0.9 });
  return { mode: "live", calls: [], search: async () => results.map(ent), insights: async () => [], tags: async () => [], heatmap: async () => [] };
}

describe("artist resolution (live /search returns near matches)", () => {
  it("normalizes names: case, accents, punctuation, '&' and a leading 'The'", () => {
    expect(nameKey("The Beatles")).toBe(nameKey("beatles"));
    expect(nameKey("Beyoncé")).toBe("beyonce");
    expect(nameKey("Simon & Garfunkel")).toBe(nameKey("Simon and Garfunkel"));
    expect(nameKey("  Glass Harbor Trio!")).toBe("glass harbor trio");
    expect(nameKey("Static Gloss")).not.toBe(nameKey("Marigold Static"));
  });

  it("refuses a fuzzy match and lists the closest names", async () => {
    const r = await new Tools(fuzzySearch(["Static Gloss", "Marigold Drive"]), new Registry()).call("resolve_artist", { name: "Marigold Static" });
    expect(r.out).toMatchObject({ error: expect.stringContaining('No Qloo artist is named "Marigold Static". Closest matches: Static Gloss, Marigold Drive') });
  });

  it("takes the exact match even when it is not the first result", async () => {
    const r = await new Tools(fuzzySearch(["Lantern Coast & Friends", "Lantern Coast"]), new Registry()).call("resolve_artist", { name: "lantern coast" });
    expect(r.out).toMatchObject({ artist: { name: "Lantern Coast" }, alternatives: [{ name: "Lantern Coast & Friends" }] });
  });

  it("still reports no results as not found", async () => {
    const r = await new Tools(fuzzySearch([]), new Registry()).call("resolve_artist", { name: "Nobody" });
    expect(r.out).toMatchObject({ error: expect.stringContaining('No Qloo artist found for "Nobody"') });
  });
});

describe("mock heatmap mirrors the live shape", () => {
  const cell = (affinity: number): HeatCell => ({ lat: 0, lon: 0, affinity, mock: true });

  it("percentileAffinity ranks cells onto 0..1, ties share the mean rank", () => {
    const cells = [0.2, 0.9, 0.5, 0.5, 0.1].map(cell);
    percentileAffinity(cells);
    expect(cells.map((c) => c.affinity)).toEqual([0.25, 1, 0.625, 0.625, 0]);
    const one = [cell(0.3)];
    percentileAffinity(one);
    expect(one[0]!.affinity).toBe(1);
  });

  it("mock heatmap deciles sit at 0.1, 0.2, ... like live, and every market in the area has a cell", async () => {
    const q = new MockQlooClient([0, 0]);
    const cells = await q.heatmap({ "signal.interests.entities": "mock-artist-marigold-static", "filter.location": LOWER48_WKT });
    const v = cells.map((c) => c.affinity).sort((a, b) => a - b);
    for (const p of [0.1, 0.5, 0.9]) expect(v[Math.round((v.length - 1) * p)]).toBeCloseTo(p, 1);
    const at = new Set(cells.map((c) => `${c.lat},${c.lon}`));
    expect(US_CITIES.filter((c) => inRing(c, LOWER48_RING) && !at.has(`${c.lat},${c.lon}`))).toEqual([]);
  });
});

describe("live-calibrated rule values (docs/SOURCES.md, Live calibration 2026-10-21)", () => {
  it("records the calibrated values and the reason", () => {
    expect([RULES.minAffinity.value, RULES.metroReadRadiusMi.value, RULES.nationalReadRadiusMi.value, RULES.strongThreshold.value, RULES.weakThreshold.value]).toEqual([0.94, 5, 15, 0.95, 0.91]);
    for (const k of ["minAffinity", "metroReadRadiusMi", "nationalReadRadiusMi", "strongThreshold", "weakThreshold"] as const) expect(RULES[k].why).toContain("Live calibration 2026-10-21");
    expect(RULES.weakThreshold.value).toBeLessThanOrEqual(RULES.strongThreshold.value);
  });
});
