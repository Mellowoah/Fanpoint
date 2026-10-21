import { describe, expect, it } from "vitest";
import { distribution, enteredLeft, fmt, hitRate, jaccard, kendallTau, spearman, topNOverlap } from "../scripts/baseline/metrics.mjs";
import { compare, rankCompare } from "../scripts/compare-baselines.mjs";

describe("baseline ranking metrics", () => {
  it("top-N overlap counts shared items in each list's first N", () => {
    expect(topNOverlap(["a", "b", "c", "d"], ["b", "x", "a", "d"], 2)).toBe(1);
    expect(topNOverlap(["a", "b", "c", "d"], ["b", "x", "a", "d"], 4)).toBe(3);
    expect(topNOverlap([], ["a"], 5)).toBe(0);
  });

  it("Jaccard is |A∩B| / |A∪B|, and 1 for two empty sets", () => {
    expect(jaccard(["a", "b", "c"], ["b", "c", "d"])).toBe(0.5);
    expect(jaccard(["a"], ["b"])).toBe(0);
    expect(jaccard([], [])).toBe(1);
  });

  it("Kendall tau over shared items", () => {
    expect(kendallTau(["a", "b", "c", "d"], ["a", "b", "c", "d"])).toBe(1);
    expect(kendallTau(["a", "b", "c", "d"], ["d", "c", "b", "a"])).toBe(-1);
    expect(kendallTau(["a", "b", "c"], ["a", "c", "b"])).toBeCloseTo(1 / 3);
    expect(kendallTau(["a", "b", "x"], ["b", "y", "a"])).toBe(-1); // only a and b are shared, swapped
    expect(kendallTau(["a"], ["a"])).toBeNull();
    expect(kendallTau(["a", "b"], ["c", "d"])).toBeNull();
  });

  it("Spearman rho over shared items", () => {
    expect(spearman(["a", "b", "c"], ["a", "b", "c"])).toBe(1);
    expect(spearman(["a", "b", "c"], ["a", "c", "b"])).toBe(0.5);
    expect(spearman(["a", "b", "c", "d"], ["d", "c", "b", "a"])).toBe(-1);
    expect(spearman(["a", "q", "b", "c"], ["a", "b", "z", "c"])).toBe(1); // q and z are ignored
    expect(spearman(["a"], ["b"])).toBeNull();
  });

  it("entered / left the top N", () => {
    expect(enteredLeft(["a", "b", "c"], ["a", "d", "b"], 2)).toEqual({ entered: ["d"], left: ["b"] });
    expect(enteredLeft(["a", "b"], ["a", "b"], 5)).toEqual({ entered: [], left: [] });
  });

  it("distribution and hit rate ignore non-numbers", () => {
    expect(distribution([3, 1, 2, null, Number.NaN, 4])).toEqual({ n: 4, min: 1, p25: 1.75, median: 2.5, p75: 3.25, max: 4, mean: 2.5 });
    expect(distribution([0.5])).toMatchObject({ n: 1, min: 0.5, median: 0.5, max: 0.5 });
    expect(distribution([null, undefined])).toBeNull();
    expect(hitRate([0.5, 0.7, 0.9, null], 0.7)).toBeCloseTo(2 / 3);
    expect(hitRate([], 0.7)).toBeNull();
  });

  it("fmt", () => {
    expect(fmt(null)).toBe("–");
    expect(fmt(undefined)).toBe("–");
    expect(fmt(0.126)).toBe("0.13");
    expect(fmt(1.25, 1)).toBe("1.3");
    expect(fmt("x")).toBe("x");
  });

  it("rankCompare combines the metrics by id", () => {
    const c = (id: string) => ({ id, name: id.toUpperCase() });
    const r = rankCompare(["a", "b", "c", "d"].map(c), ["b", "a", "e", "c"].map(c), 2);
    expect(r).toMatchObject({ overlap: 2, n: 2, entered: [], left: [] });
    expect(r.jaccard).toBe(0.6);
    expect(r.tau).toBeCloseTo(1 / 3);
  });
});

// Minimal synthetic baselines in the routed-baseline/1 shape (only the fields compare() reads).
const city = (id: string, affinity: number, population = 1) => ({ id, name: id, affinity, population, venues: 1 });
const meta = (mode: string, sha = "s1") => ({
  mode, timestamp: "2026-10-19T20:00:00-04:00", health: { qloo: mode, llm: "mock" }, git: { commit: "abc", dirty: false },
  inputs: { version: 1, sha256: sha }, data: { "markets.json": "m1" },
});
const fill = (id: string, withQloo: ReturnType<typeof city>[], fills: string[], floor = 0.6) => ({
  id, kind: "fill", status: "ok", params: { minAffinity: floor }, rules: { minAffinity: floor, minVenues: 1 }, qlooCalls: [{}],
  gaps: [{
    from: "A", to: "B", eligible: withQloo.length, droppedByHardFilters: [{ id: "z", name: "z", reason: "no mapped venue: 0 within 10 mi (OSM)" }],
    qlooCandidates: { considered: withQloo.map((c) => ({ name: c.name, affinity: c.affinity, status: c.affinity >= floor ? "picked" : "below heat floor" })) },
    withQloo, withoutQloo: [...withQloo].sort((p, q) => q.population - p.population),
  }],
  withQloo: { fills: fills.map((c) => ({ city: c, cityId: c })) },
});
const cohead = (id: string, ranking: string[], strongReads: number[]) => ({
  id, kind: "cohead", status: "ok", thresholds: { strong: 0.7, weak: 0.4 }, qlooCalls: [],
  withQloo: { ranking: ranking.map((p, i) => ({ id: p, name: p, score: 10 - i, similarity: 0.5, picked: i === 0 })), recommended: ranking.slice(0, 1) },
  cityAffinity: { you: strongReads, peers: { [ranking[0] as string]: [0.1, null] } },
});

describe("compare-baselines report", () => {
  const A = { meta: meta("mock"), runs: [
    fill("f1", [city("a", 0.9, 1), city("b", 0.8, 3), city("c", 0.5, 2)], ["a"]),
    cohead("c1", ["p", "q", "r"], [0.9, 0.2]),
    { ...fill("demo", [city("a", 0.9)], ["a"]), mockOnly: true },
  ] };
  const B = { meta: { ...meta("live", "s2"), data: { "markets.json": "m2" } }, runs: [
    { ...fill("f1", [city("c", 0.95, 2), city("a", 0.7, 1), city("d", 0.65, 4)], ["c", "a"]), rules: { minAffinity: 0.5, minVenues: 1 } },
    cohead("c1", ["q", "p", "s"], [0.9, 0.8]),
    { id: "demo", kind: "fill", status: "error", mockOnly: true, error: { code: "not_found", message: "no such artist" } },
    { id: "new-only-in-b", kind: "cohead", status: "ok" },
  ] };
  const md = compare(A, B, 2);

  it("reports metadata, changed data files and input-set mismatch", () => {
    expect(md).toContain("mock (2026-10-19T20:00:00-04:00) vs live");
    expect(md).toContain("m2 **changed**");
    expect(md).toContain("the input sets differ");
  });

  it("reports per-input ranking shifts, fills and heat-floor hit rates", () => {
    // f1 top-2: A [a,b] vs B [c,a] -> overlap 1, c entered, b left; shared a,c are swapped (a<c in A, c<a in B) -> tau -1
    expect(md).toMatch(/\| f1 \| 1\/2 \| -1\.00 \| -1\.00 \| 1 → 2 \(J 0\.50\) \| 67% → 100% \|/);
    expect(md).toContain("| A → B | 3 → 3 | 1/2 | 0.50 | -1.00 | -1.00 | c | b |");
    expect(md).toContain('Hard-filter drops: A {"no mapped venue":1}');
    expect(md).toContain("Fills: A a · B c, a");
    // With vs Without within each run: A by affinity [a,b], by population [b,c] -> 1 shared; B [c,a] vs [d,c] -> 1
    expect(md).toContain("With vs Without top-2 overlap per leg: A 1 · B 1");
  });

  it("reports co-headliner ranking, picks and threshold hit rates", () => {
    expect(md).toMatch(/\| c1 \| 2\/2 \| -1\.00 \|/);
    expect(md).toContain("Entered: – · Left: –");
    expect(md).toContain("Recommended: A p · B q");
    expect(md).toContain("A 33% / 33% of 3 · B 67% / 67% of 3");
  });

  it("lists errored and missing inputs and notes mock-only ones", () => {
    expect(md).toContain("| demo | ok | `not_found` | mock-only input");
    expect(md).toContain("| new-only-in-b | missing | ok |");
  });

  it("reports rule changes and says none when runs match", () => {
    expect(md).toContain("`minAffinity` 0.6 → 0.5");
    const same = compare(A, A, 5);
    expect(same).toContain("**Rule changes:** none");
    expect(same).toContain("## Errored or missing inputs\n\nNone.");
  });
});
