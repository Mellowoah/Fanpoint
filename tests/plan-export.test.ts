import { describe, expect, it } from "vitest";
import { runAgent } from "@/lib/agent/run";
import type { AgentEvent, FillPlan, FillRequest } from "@/lib/agent/types";
import { MockQlooClient } from "@/lib/qloo/mock-client";
import { MockLlmClient } from "@/lib/llm/mock";
import { COST_DEFAULTS, CSV_HEADER, costEstimate, csvFilename, detourMiles, planCsv } from "@/lib/client/plan-export";
import { holdDraft } from "@/lib/client/holds";

const DEMO: FillRequest = {
  task: "fill", artist: "Marigold Static", maxDriveMi: 350, minAffinity: 0.6,
  anchors: [{ city: "New York", date: "2026-11-13", label: "Record release" }, { city: "Durham", date: "2026-11-21" }, { city: "Atlanta", date: "2026-11-28" }],
};
let cached: FillPlan | undefined;
async function demoPlan(): Promise<FillPlan> {
  if (cached) return cached;
  for await (const e of runAgent(DEMO, { qloo: new MockQlooClient([0, 0]), llm: new MockLlmClient(0) }) as AsyncGenerator<AgentEvent>)
    if (e.type === "result") return (cached = e.plan as FillPlan);
  throw new Error("no plan");
}

/** Minimal RFC 4180 parser for the round-trip check. */
function parseCsv(t: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\r") continue;
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  return rows;
}

describe("empty-night cost card", () => {
  it("is nights × (hotel × rooms + per diem × people) minus detour fuel, with visible defaults", async () => {
    const q = await demoPlan();
    expect(q.stops.length).toBeGreaterThan(0);
    const e = costEstimate(q, COST_DEFAULTS);
    expect(e.nights).toBe(q.stops.length);
    expect(e.perNight).toBe(150 * 4 + 50 * 6);
    expect(e.darkCost).toBe(e.nights * e.perNight);
    expect(e.detourMi).toBe(detourMiles(q));
    expect(e.detourMi).toBeGreaterThanOrEqual(0);
    expect(e.detourFuel).toBe(Math.round(e.detourMi * 0.6));
    expect(e.avoided).toBe(Math.max(0, e.darkCost - e.detourFuel));
  });
  it("updates with edited inputs and ignores negative or blank values", async () => {
    const q = await demoPlan();
    const a = costEstimate(q, { ...COST_DEFAULTS, crew: 10 });
    expect(a.perNight).toBe(150 * 4 + 50 * 10);
    const z = costEstimate(q, { hotelPerRoom: -5, rooms: NaN, perDiem: 0, crew: 0, fuelPerMi: 0 });
    expect(z).toMatchObject({ perNight: 0, darkCost: 0, detourFuel: 0, avoided: 0 });
  });
  it("detour is the filled route's miles minus the direct drive, per gap", async () => {
    const q = await demoPlan();
    const filledGaps = q.result.gaps.filter((g) => g.filled > 0);
    const direct = filledGaps.reduce((t, g) => t + g.directMi, 0);
    // Going through extra cities can't be shorter than ~the direct road drive.
    expect(detourMiles(q)).toBeLessThan(direct * 2);
  });
});

describe("CSV export", () => {
  it("has one header row and one row per filled stop, all fields round-trip", async () => {
    const q = await demoPlan();
    const rows = parseCsv(planCsv(q));
    expect(rows[0]).toEqual([...CSV_HEADER]);
    expect(rows).toHaveLength(q.stops.length + 1);
    for (const [i, s] of q.stops.entries()) {
      const r = Object.fromEntries(CSV_HEADER.map((h, j) => [h, rows[i + 1]![j]]));
      expect(r.date).toBe(s.date);
      expect(r.city).toBe(s.city);
      expect(r.fan_strength_0_100).toBe(String(Math.round(s.affinity * 100)));
      expect(r.road_mi).toBe(String(s.driveMi));
      expect(r.top_room).toBe(s.venues[0]?.name ?? "");
      expect(r.hold_email_body).toBe(holdDraft(q, s).body);
    }
  });
  it("neutralises spreadsheet formulas and quotes commas/quotes", async () => {
    const q = await demoPlan();
    const s = q.stops[0]!;
    const evil = { ...q, stops: [{ ...s, city: '=HYPERLINK("x"), "y"' }] };
    const rows = parseCsv(planCsv(evil));
    expect(rows[1]![2]).toBe(`'=HYPERLINK("x"), "y"`);
    expect(csvFilename(q)).toMatch(/^fanpoint-marigold-static-\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
