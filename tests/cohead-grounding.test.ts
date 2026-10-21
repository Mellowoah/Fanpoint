import { describe, expect, it } from "vitest";
import { complementarity as complementarityAt, THRESHOLDS, type Thresholds } from "@/lib/cohead/complementarity";

// Logic tests use the original 0.75 / 0.60 thresholds on hand-made heat; the live defaults are checked below.
const LEGACY: Thresholds = { strong: 0.75, weak: 0.6 };
const complementarity = (a: Map<string, number>, b: Map<string, number>, t: Thresholds = LEGACY) => complementarityAt(a, b, t);
import { createGrounder } from "@/lib/agent/grounding";

const m = (o: Record<string, number>) => new Map(Object.entries(o));

describe("complementarity", () => {
  it("scores two-way coverage and lists gains strongest-first", () => {
    const you = m({ Boston: 0.9, Austin: 0.4, Denver: 0.5, Miami: 0.95 });
    const them = m({ Boston: 0.3, Austin: 0.85, Denver: 0.95, Miami: 0.2 });
    const c = complementarity(you, them);
    expect(c.youGain).toEqual(["Denver", "Austin"]); // sorted by THEIR heat
    expect(c.theyGain).toEqual(["Miami", "Boston"]); // sorted by YOUR heat
    expect(c.overlap).toEqual([]);
    expect(c.score).toBe(4); // 2 + 2 - 0 - 0
    expect(c).toMatchObject({ youStrong: 2, themStrong: 2, coveredStrong: 4, newStrongForYou: 2, newStrongForThem: 2 });
  });
  it("penalises one-sided deals by half the imbalance", () => {
    const c = complementarity(m({ A: 0.4, B: 0.4, C: 0.4, D: 0.9 }), m({ A: 0.9, B: 0.9, C: 0.9, D: 0.9 }));
    // youGain 3, theyGain 0, overlap 1 -> 3 - 1.5 - 0.25
    expect(c.youGain).toHaveLength(3);
    expect(c.overlap).toEqual(["D"]);
    expect(c.score).toBe(1.25);
  });
  it("the most similar act (same strong cities) scores below zero", () => {
    const same = m({ A: 0.9, B: 0.85, C: 0.8, D: 0.95 });
    const c = complementarity(same, same);
    expect(c.youGain).toEqual([]);
    expect(c.overlap).toHaveLength(4);
    expect(c.score).toBe(-1);
    expect(c.newStrongForYou).toBe(0);
  });
  it("uses inclusive strong (>=0.75) and exclusive weak (<0.60) thresholds", () => {
    expect(THRESHOLDS).toEqual({ strong: 0.95, weak: 0.91 }); // live calibration 2026-10-21 (docs/SOURCES.md)
    expect(complementarityAt(m({ X: 0.9 }), m({ X: 0.95 })).youGain).toEqual(["X"]);
    expect(complementarityAt(m({ X: 0.91 }), m({ X: 0.95 })).youGain).toEqual([]);
    expect(complementarity(m({ X: 0.59 }), m({ X: 0.75 })).youGain).toEqual(["X"]);
    expect(complementarity(m({ X: 0.6 }), m({ X: 0.75 })).youGain).toEqual([]); // 0.60 is not weak
    expect(complementarity(m({ X: 0.59 }), m({ X: 0.7499 })).youGain).toEqual([]);
  });
  it("middling cities (between weak and strong) count for nothing", () => {
    const c = complementarity(m({ X: 0.7 }), m({ X: 0.7 }));
    expect(c).toMatchObject({ score: 0, coveredStrong: 0 });
  });
  it("skips cities read for only one act for gains, but counts them in coverage", () => {
    const c = complementarity(m({ OnlyYou: 0.9, Both: 0.4 }), m({ OnlyThem: 0.9, Both: 0.9 }));
    expect(c.youGain).toEqual(["Both"]);
    expect(c.theyGain).toEqual([]);
    expect(c.coveredStrong).toBe(3);
    expect(c.newStrongForYou).toBe(2); // union 3 - your 1
    expect(c.newStrongForThem).toBe(1); // union 3 - their 2
  });
  it("coverage gains are never negative (regression: union used to skip one-sided cities)", () => {
    const c = complementarity(m({ A: 0.9, B: 0.9, C: 0.9 }), m({ A: 0.2 }));
    expect(c.newStrongForYou).toBeGreaterThanOrEqual(0);
    expect(c.newStrongForThem).toBeGreaterThanOrEqual(0);
  });
  it("empty inputs score 0", () => {
    expect(complementarity(new Map(), new Map())).toMatchObject({ score: 0, coveredStrong: 0, youGain: [] });
  });
  it("accepts custom thresholds and rejects inverted ones", () => {
    expect(complementarity(m({ X: 0.65 }), m({ X: 0.7 }), { strong: 0.7, weak: 0.66 }).youGain).toEqual(["X"]);
    expect(() => complementarity(new Map(), new Map(), { strong: 0.5, weak: 0.6 })).toThrow(RangeError);
  });
  it("ties in gain lists sort by name (stable output)", () => {
    const c = complementarity(m({ b: 0.4, a: 0.4 }), m({ b: 0.9, a: 0.9 }));
    expect(c.youGain).toEqual(["a", "b"]);
  });
});

describe("grounding filter", () => {
  const known = new Map([["id-1", { name: "Venue One" }], ["id-2", { name: "Act Two" }]]);
  it("keeps known ids, drops and lists unknown ones", () => {
    const g = createGrounder(known);
    expect(g.pick("id-1")).toEqual({ name: "Venue One" });
    expect(g.pick("made-up")).toBeUndefined();
    expect(g.report()).toEqual({ referenced: 2, grounded: 1, dropped: ["made-up"] });
  });
  it("pickAll preserves order, dedupes, filters unknowns", () => {
    const g = createGrounder(known);
    expect(g.pickAll(["id-2", "nope", "id-1", "id-2"]).map((e) => e.name)).toEqual(["Act Two", "Venue One"]);
    expect(g.report()).toEqual({ referenced: 3, grounded: 2, dropped: ["nope"] });
  });
  it("report is a snapshot (later picks don't mutate it)", () => {
    const g = createGrounder(known);
    g.pick("x");
    const r = g.report();
    g.pick("y");
    expect(r.dropped).toEqual(["x"]);
  });
  it("empty registry grounds nothing", () => {
    const g = createGrounder(new Map<string, unknown>());
    expect(g.pickAll(["a", "b"])).toEqual([]);
    expect(g.report()).toEqual({ referenced: 2, grounded: 0, dropped: ["a", "b"] });
  });
});
