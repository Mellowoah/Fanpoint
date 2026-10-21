/** Run-wide support act, holiday rule, stated capacities. Synthetic data only. */
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, DEFAULT_PARAMS, fillTour, holidayName, type Anchor, type Candidate } from "@/lib/route/fill";
import { statedCapacity } from "@/lib/qloo/venues";
import { RULES } from "@/lib/touring/rules";
import { RuleOverrides } from "@/lib/api/plan-request";
import { Registry, Tools } from "@/lib/agent/tools";
import { runAgent } from "@/lib/agent/run";
import { MockQlooClient } from "@/lib/qloo/mock-client";
import { MockLlmClient } from "@/lib/llm/mock";
import { ProviderError } from "@/lib/net/errors";
import { cacheClear } from "@/lib/cache";
import type { AgentEvent, FillPlan } from "@/lib/agent/types";
import type { QlooParams, QlooRawEntity } from "@/lib/qloo/types";
import { FLAT, testRoad } from "./helpers";

beforeEach(() => cacheClear());

describe("holidays rule", () => {
  it("names Thanksgiving (4th Thursday of November), Dec 24 and Dec 25, and not New Year's Eve", () => {
    expect(holidayName("2026-11-26")).toBe("Thanksgiving");
    expect(holidayName("2027-11-25")).toBe("Thanksgiving");
    expect(holidayName("2026-11-19")).toBeUndefined(); // 3rd Thursday
    expect(holidayName("2026-11-27")).toBeUndefined();
    expect(holidayName("2026-12-24")).toBe("Christmas Eve");
    expect(holidayName("2026-12-25")).toBe("Christmas Day");
    expect(holidayName("2026-12-31")).toBeUndefined();
    expect(RULES.holidaysOff).toMatchObject({ value: 1, kind: "assumption", adjustable: true });
    expect(DEFAULT_PARAMS.holidaysOff).toBe(1);
  });
  // Two anchors 4 days apart around Thanksgiving 2026, one candidate city per day's worth of road.
  const A: Anchor = { city: "West", lat: 35, lon: -80, date: "2026-11-24" };
  const B: Anchor = { city: "East", lat: 35, lon: -76, date: "2026-11-28" };
  const cands: Candidate[] = [-79, -78, -77].map((lon, i) => ({ name: `C${i}`, lat: 35, lon, affinity: 0.99 }));
  const params = { ...DEFAULT_PARAMS, dowWeights: FLAT, radiusMi: 30, minAffinity: 0.5, maxConsecutiveShows: 9 };
  it("keeps the holiday off and marks it; turning the rule off allows a show", () => {
    const on = fillTour([A, B], [cands], params, testRoad);
    const tg = on.calendar.find((d) => d.date === "2026-11-26")!;
    expect(tg).toMatchObject({ kind: "off", holiday: "Thanksgiving" });
    expect(on.calendar.filter((d) => d.kind === "fill").length).toBeGreaterThan(0);
    const off = fillTour([A, B], [cands], { ...params, holidaysOff: 0 }, testRoad);
    expect(off.calendar.find((d) => d.date === "2026-11-26")!.kind).toBe("fill");
    expect(off.calendar.some((d) => d.holiday)).toBe(false);
  });
  it("labels holidays inside an infeasible gap too, and accepts 0/1 overrides only", () => {
    const far: Anchor = { city: "Far", lat: 35, lon: -60, date: addDays(A.date, 2) };
    expect(fillTour([A, far], [[]], params, testRoad).calendar.find((d) => d.date === "2026-11-25")).toBeDefined();
    const g = fillTour([{ ...A, date: "2026-12-23" }, { ...far, date: "2026-12-26" }], [[]], params, testRoad).gaps[0]!;
    expect(g.feasible).toBe(false);
    expect(g.days.map((d) => d.holiday)).toEqual(["Christmas Eve", "Christmas Day"]);
    expect(RuleOverrides.safeParse({ holidaysOff: 0 }).success).toBe(true);
    expect(RuleOverrides.safeParse({ holidaysOff: true }).success).toBe(false);
    expect(RuleOverrides.safeParse({ holidaysOff: 2 }).success).toBe(false);
  });
});

describe("stated capacities", () => {
  it.each([
    ["A 2,500-capacity concert hall.", 2500],
    ["Enduring 750-seat live music venue.", 750],
    ["The main room has 1,200 seats.", 1200],
    ["The room holds 450 people on a busy night.", 450],
    ["The ballroom seats 400.", 400],
    ["The room fits 250 fans.", 250],
    ["It accommodates up to 300 guests.", 300],
    ["Private events for up to 500 guests.", 500],
    ["Standing capacity: 900.", 900],
    ["A capacity of approximately 1,100.", 1100],
  ])("reads %s", (text, n) => expect(statedCapacity([text])?.capacity).toBe(n));
  it.each(["Holds 20 events a year since 1999.", "Open 365 days.", "Founded in 1927, two stages.", "Seats are first come.", "It seats 300 events a year.", "Events for 50-500 guests."])("does not invent a number from %s", (text) => {
    expect(statedCapacity([text])).toBeUndefined();
  });
});

class Scripted extends MockQlooClient {
  constructor(private o: { national?: (p: QlooParams) => QlooRawEntity[]; compare?: () => never } = {}) { super([0, 0]); }
  override async insights(p: QlooParams) {
    if (this.o.national && p["filter.type"] === "urn:entity:artist" && p.take === 10 && !p["signal.location.query"]) return this.o.national(p);
    return super.insights(p);
  }
  override async compare(a: string, b: string) { if (this.o.compare) this.o.compare(); return super.compare(a, b); }
}
const fail = () => { throw new ProviderError("qloo", "upstream", "injected"); };
const act = (name: string, popularity: number, affinity: number): QlooRawEntity => ({ name, entity_id: `id-${name}`, subtype: "urn:entity:artist", popularity, query: { affinity } });

describe("run-wide support act", () => {
  async function setup(q: MockQlooClient) {
    const reg = new Registry();
    const t = new Tools(q, reg);
    await t.call("resolve_artist", { name: "Marigold Static" });
    for (const city of ["Durham", "Richmond", "Charlotte"]) await t.call("get_city_intel", { artist_id: reg.artist!.id, city });
    return { reg, t };
  }
  it("prefers the act listed locally in the most filled cities, under the opener popularity ceiling", async () => {
    let asked: QlooParams | undefined;
    const q = new Scripted({ national: (p) => { asked = p; return [act("Peer Sized", 0.99, 0.99), act("Opener", 0.3, 0.95)]; } });
    const { reg, t } = await setup(q);
    const pop = reg.artist!.popularity!;
    const ceiling = +(pop - 0.02).toFixed(3);
    const local = [...new Set(["durham", "richmond", "charlotte"].flatMap((c) => reg.intel.get(c)!.support.filter((e) => (e.popularity ?? 0) <= ceiling).map((e) => e.id)))];
    // Every local call was asked for acts under the ceiling too.
    expect(q.calls.filter((c) => c.params["signal.location.query"] && c.params["filter.type"] === "urn:entity:artist").every((c) => Number(c.params["filter.popularity.max"]) === +(pop - 0.02).toFixed(3))).toBe(true);
    const r = await t.runSupport(reg.artist!.id, ["Durham", "Richmond", "Charlotte"]);
    expect(asked).toMatchObject({ "signal.interests.entities": reg.artist!.id, "filter.popularity.max": +(pop - 0.02).toFixed(3) });
    expect(r.pick!.entity.name).not.toBe("Peer Sized"); // above the ceiling
    const counts = local.map((id) => ["durham", "richmond", "charlotte"].filter((c) => reg.intel.get(c)!.support.some((e) => e.id === id)).length);
    expect(r.pick!.stops.length).toBe(Math.max(...counts, 0));
    expect(r.pick!.fills).toBe(3);
    expect(r.pick!.why).toMatch(/local support match in \d of 3 filled cities/);
    expect(reg.runSupport).toBe(r.pick);
  });
  it("falls back to the national match, then to nothing; failures stay soft", async () => {
    const reg = new Registry();
    const t = new Tools(new Scripted({ national: () => [act("Opener", 0.1, 0.9)], compare: fail }), reg);
    await t.call("resolve_artist", { name: "Marigold Static" });
    const r = await t.runSupport(reg.artist!.id, ["Nowhere"]);
    expect(r.pick).toMatchObject({ entity: { name: "Opener" }, stops: [], national: 0.9, shared: [] });
    expect(r.pick!.why).toMatch(/top national taste match/);
    expect(reg.warnings.join(" ")).toMatch(/Support act shared taste/);
    const reg2 = new Registry();
    const t2 = new Tools(new Scripted({ national: fail }), reg2);
    await t2.call("resolve_artist", { name: "Marigold Static" });
    expect((await t2.runSupport(reg2.artist!.id, [])).pick).toBeUndefined();
    expect(reg2.runSupport).toBeNull();
  });
  it("end to end (mock): the plan carries one support act; stops list only other local acts", async () => {
    const ev: AgentEvent[] = [];
    for await (const e of runAgent({ task: "fill", artist: "Marigold Static", maxDriveMi: 350, minAffinity: 0.6, anchors: [{ city: "New York", date: "2026-11-13" }, { city: "Durham", date: "2026-11-21" }, { city: "Atlanta", date: "2026-11-28" }] }, { qloo: new MockQlooClient([0, 0]), llm: new MockLlmClient(0) })) ev.push(e);
    const plan = (ev.find((e) => e.type === "result") as Extract<AgentEvent, { type: "result" }>).plan as FillPlan;
    expect(plan.support?.entity.kind).toBe("artist");
    expect(plan.stops.every((s) => s.support.every((e) => e.id !== plan.support!.entity.id))).toBe(true);
    expect(ev.some((e) => e.type === "tool" && e.name === "run_support")).toBe(true);
    expect(plan.result.calendar.find((d) => d.date === "2026-11-26")).toMatchObject({ kind: "off", holiday: "Thanksgiving" });
  });
});

describe("cityLabel", () => {
  it("adds the state once", async () => {
    const { cityLabel } = await import("@/lib/route/city-label");
    expect(cityLabel("Durham", "NC")).toBe("Durham, NC");
    expect(cityLabel("Columbia, SC", "SC")).toBe("Columbia, SC");
    expect(cityLabel("Durham")).toBe("Durham");
  });
});

describe("splitWarnings", () => {
  it("folds number-check drops into one label and keeps other warnings", async () => {
    const { splitWarnings } = await import("@/lib/client/warnings");
    expect(splitWarnings()).toEqual({ numberCheck: [], other: [] });
    const stops = splitWarnings(["AI text dropped for Camden: it used numbers not in the data (13).", "AI text dropped for Lancaster: it used numbers not in the data (4)."]);
    expect(stops.label).toBe("AI notes hidden for 2 stops (number check)");
    expect(splitWarnings(["AI text dropped for Camden: it used numbers not in the data (13)."]).label).toBe("AI notes hidden for 1 stop (number check)");
    const mixed = splitWarnings(["AI promo angle dropped for X: numbers not in the data (5).", "AI text dropped for the summary: it used numbers not in the data (9).", "No Qloo fan data for Y."]);
    expect(mixed).toMatchObject({ other: ["No Qloo fan data for Y."], label: "AI text hidden in 2 places (number check)" });
    expect(splitWarnings(["AI pitch dropped for Z: it used numbers not in the data (1)."]).label).toBe("AI text hidden in 1 place (number check)");
  });
});
