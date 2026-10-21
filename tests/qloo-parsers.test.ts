import { describe, expect, it } from "vitest";
import heatmapDoc from "./fixtures/qloo-shapes/heatmap.json";
import insightsDoc from "./fixtures/qloo-shapes/insights-entities.json";
import artistDoc from "./fixtures/qloo-shapes/insights-artist.json";
import searchDoc from "./fixtures/qloo-shapes/search.json";
import tagsDoc from "./fixtures/qloo-shapes/tags.json";
import { countResults, parseHeatmap, parseInsights, parseSearch, parseTags } from "@/lib/qloo/schemas";
import { normalize } from "@/lib/qloo/normalize";
import { ProviderError } from "@/lib/net/errors";

const clone = <T,>(x: T): T => structuredClone(x);
const invalid = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof ProviderError && e.code === "invalid_response" && e.provider === "qloo"; }
  return false;
};

describe("parseHeatmap (documented shape, synthetic values)", () => {
  it("parses every documented cell", () => {
    const p = parseHeatmap(heatmapDoc);
    expect(p.dropped).toBe(0);
    expect(p.items).toHaveLength(3);
    expect(p.items[0]).toEqual({ location: { latitude: 40.5, longitude: -73.75, geohash: "dr5wcb" }, query: { affinity: 1, affinity_rank: 0.99, popularity: 0.97 } });
  });
  it("drops cells without affinity or with out-of-range values, keeps the rest", () => {
    const j = clone(heatmapDoc);
    const cells = j.results.heatmap as unknown[];
    delete (cells[0] as { query: { affinity?: number } }).query.affinity;
    (cells[1] as { location: { latitude: number } }).location.latitude = 123;
    cells.push({ location: { latitude: "40", longitude: -73 }, query: { affinity: 0.5 } }, null, "junk", { location: { latitude: 1, longitude: 2 }, query: { affinity: 1.5 } });
    const p = parseHeatmap(j);
    expect(p.items).toHaveLength(1);
    expect(p.dropped).toBe(6);
  });
  it("treats odd optional fields as absent instead of dropping the cell", () => {
    const j = clone(heatmapDoc);
    (j.results.heatmap[0] as { query: Record<string, unknown> }).query.popularity = "high";
    const p = parseHeatmap(j);
    expect(p.items[0]?.query.popularity).toBeUndefined();
    expect(p.dropped).toBe(0);
  });
  it("an empty heatmap is valid", () => expect(parseHeatmap({ results: { heatmap: [] } })).toEqual({ items: [], dropped: 0 }));
  it.each([
    ["null", null], ["array", []], ["no results", { success: true }], ["entities instead of heatmap", { results: { entities: [] } }], ["heatmap not array", { results: { heatmap: {} } }],
  ])("rejects a wrong envelope: %s", (_, body) => expect(invalid(() => parseHeatmap(body))).toBe(true));
});

describe("parseInsights (documented shape, synthetic values)", () => {
  it("parses the documented entity and ignores fields Routed doesn't use", () => {
    const p = parseInsights(insightsDoc);
    expect(p.items).toHaveLength(1);
    const e = normalize(p.items[0]!);
    expect(e).toMatchObject({ id: "00000000-0000-0000-0000-0000000000a1", name: "Example Movie (synthetic)", kind: "other", mock: false });
    expect(e.description).toMatch(/Synthetic placeholder entity/);
  });
  it("artist entities: popularity, affinity and tags come through", () => {
    const [a] = parseInsights(artistDoc).items;
    expect(normalize(a!)).toMatchObject({ kind: "artist", popularity: 0.81, affinity: 0.93, tags: ["Indie"] });
  });
  it("drops entities missing id or name; keeps entities with junk optional fields", () => {
    const j = clone(artistDoc) as { results: { entities: Record<string, unknown>[] } };
    j.results.entities.push({ name: "No id" }, { entity_id: "x", name: "" }, { entity_id: "y", name: "Weird", popularity: "lots", tags: "nope", query: { affinity: "hi" }, location: 7 });
    const p = parseInsights(j);
    expect(p.dropped).toBe(2);
    const weird = normalize(p.items.find((x) => x.entity_id === "y")!);
    expect(weird).toMatchObject({ popularity: undefined, affinity: undefined, tags: [], lat: undefined });
  });
  it("rejects a wrong envelope", () => {
    expect(invalid(() => parseInsights({ results: { heatmap: [] } }))).toBe(true);
    expect(invalid(() => parseInsights({ results: null }))).toBe(true);
    expect(invalid(() => parseInsights("<html>"))).toBe(true);
  });
});

describe("parseSearch / parseTags", () => {
  it("search: array envelope", () => {
    const p = parseSearch(searchDoc);
    expect(normalize(p.items[0]!, "urn:entity:artist")).toMatchObject({ kind: "artist", description: "Example band" });
    expect(invalid(() => parseSearch({ results: "nope" }))).toBe(true);
    expect(invalid(() => parseSearch({ entities: [] }))).toBe(true);
  });
  it("accepts both list envelopes, like Qloo's harness: results[] or results.<key>[]", () => {
    const e = { entity_id: "E1", name: "One" };
    expect(parseSearch({ results: { entities: [e] } }).items).toHaveLength(1);
    expect(parseInsights({ results: [e] }).items).toHaveLength(1);
    expect(parseTags({ results: [{ id: "t", name: "T" }] }).items).toEqual([{ id: "t", name: "T" }]);
    expect(parseHeatmap({ results: [{ location: { latitude: 1, longitude: 2 }, query: { affinity: 0.5 } }] }).items).toHaveLength(1);
    expect(invalid(() => parseHeatmap({ results: { entities: [] } }))).toBe(true); // wrong key for this endpoint
  });
  it("accepts a bare id as the entity id (entity_id wins when both exist)", () => {
    expect(parseSearch({ results: [{ id: "E2", name: "Two" }] }).items[0]?.entity_id).toBe("E2");
    expect(parseSearch({ results: [{ id: "x", entity_id: "E3", name: "Three" }] }).items[0]?.entity_id).toBe("E3");
    expect(parseSearch({ results: [{ id: 7, name: "bad" }] }).dropped).toBe(1);
  });
  it("tags: requires id (or legacy tag_id)", () => {
    expect(parseTags(tagsDoc).items).toEqual([{ id: "urn:tag:category:place:music_venue", name: "Music Venue" }]);
    const p = parseTags({ results: { tags: [{ tag_id: "legacy", name: "L" }, { name: "no id" }, { id: 5, name: "bad" }] } });
    expect(p.items).toEqual([{ id: "legacy", name: "L" }]);
    expect(p.dropped).toBe(2);
  });
});

describe("normalize", () => {
  it("maps type URNs (subtype first, then types[], then type, then fallback)", () => {
    expect(normalize({ name: "n", entity_id: "i", subtype: "urn:entity:place", type: "urn:entity" }).kind).toBe("place");
    expect(normalize({ name: "n", entity_id: "i", types: ["urn:entity:brand"] }).kind).toBe("brand");
    expect(normalize({ name: "n", entity_id: "i", type: "urn:entity:locality" }).kind).toBe("destination");
    expect(normalize({ name: "n", entity_id: "i" }, "urn:entity:podcast").kind).toBe("podcast");
    expect(normalize({ name: "n", entity_id: "i" }).kind).toBe("other");
  });
  it("reads geocode, keeps at most 6 tags, flags mock records", () => {
    const e = normalize({ name: "n", entity_id: "i", _mock: true, location: { lat: 1, lon: 2 }, properties: { geocode: { city: "Durham", admin1_region: "NC", country_code: "US" } }, tags: Array.from({ length: 9 }, (_, k) => ({ name: `t${k}` })) });
    expect(e).toMatchObject({ lat: 1, lon: 2, city: "Durham", region: "NC", country: "US", mock: true });
    expect(e.tags).toHaveLength(6);
  });
});

describe("countResults", () => {
  it("counts every envelope kind and tolerates junk", () => {
    expect(countResults(heatmapDoc)).toBe(3);
    expect(countResults(insightsDoc)).toBe(1);
    expect(countResults(searchDoc)).toBe(1);
    expect(countResults(tagsDoc)).toBe(1);
    expect(countResults(null)).toBe(0);
    expect(countResults({ results: 5 })).toBe(0);
    expect(countResults({ results: { entities: "x" } })).toBe(0);
  });
});
