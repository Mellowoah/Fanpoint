/**
 * Mellow's rule: the LLM orchestrates and explains; it never decides. These tests run the agent with models that try
 * to decide (invent numbers, pick their own support acts, skip steps, choose peers) and check that code wins.
 */
import { describe, expect, it } from "vitest";
import { runAgent } from "@/lib/agent/run";
import { allowedForms, numbersIn, vetText } from "@/lib/agent/narrative";
import type { AgentEvent, CoheadPlan, FillPlan, FillRequest } from "@/lib/agent/types";
import { MockQlooClient } from "@/lib/qloo/mock-client";
import { MockLlmClient } from "@/lib/llm/mock";
import type { ChatMessage, ChatResult, ToolDef } from "@/lib/llm/types";
import { RULE_VALUES } from "@/lib/touring/rules";
import { corridor } from "@/lib/route/geo";
import { findCity } from "@/lib/route/cities";

const DEMO: FillRequest = {
  task: "fill", artist: "Marigold Static", maxDriveMi: 350, minAffinity: 0.6,
  anchors: [{ city: "New York", date: "2026-11-13" }, { city: "Durham", date: "2026-11-21" }, { city: "Atlanta", date: "2026-11-28" }],
};
async function collect(gen: AsyncGenerator<AgentEvent>) { const ev: AgentEvent[] = []; for await (const e of gen) ev.push(e); return ev; }
const plan = <T,>(ev: AgentEvent[]) => (ev.find((e) => e.type === "result") as Extract<AgentEvent, { type: "result" }> | undefined)?.plan as T;

/** A mock model whose tool calls are rewritten by `edit` before Fanpoint sees them. */
class Meddling extends MockLlmClient {
  constructor(private edit: (name: string, args: Record<string, unknown>, m: ChatMessage[]) => Record<string, unknown> | null) { super(0); }
  override async chat(m: ChatMessage[], t: ToolDef[]): Promise<ChatResult> {
    const r = await super.chat(m, t);
    const calls = r.toolCalls.flatMap((c) => {
      const next = this.edit(c.function.name, JSON.parse(c.function.arguments) as Record<string, unknown>, m);
      return next === null ? [] : [{ ...c, function: { ...c.function, arguments: JSON.stringify(next) } }];
    });
    if (!calls.length && r.toolCalls.length) { // the model skipped a step: move it on to submitting
      const name = t.some((d) => d.function.name === "submit_fill") ? "submit_fill" : "submit_cohead";
      return { content: r.content, toolCalls: [{ id: "x", type: "function", function: { name, arguments: "{}" } }] };
    }
    return { ...r, toolCalls: calls };
  }
}
const run = (edit: ConstructorParameters<typeof Meddling>[0], req: Parameters<typeof runAgent>[0] = DEMO) =>
  collect(runAgent(req, { qloo: new MockQlooClient([0, 0]), llm: new Meddling(edit) }));

describe("vetText: model prose may only use numbers from the data", () => {
  it("finds numbers with commas and decimals, not digits inside words", () => {
    expect(numbersIn("1,234 fans, 0.87 heat, 7.5 h, I-95 and 3rd").map((n) => n.value)).toEqual([1234, 0.87, 7.5, 95, 3]);
  });
  it("accepts facts in their usual written forms", () => {
    const facts = [0.874, 238, 4.1, 2_134_000, "2026-11-14", 3];
    for (const t of ["fan heat 87", "0.87 affinity", "238 road miles", "4.1 hours", "a 2.1 million metro", "Nov 14, 2026", "#3 in the corridor", "no numbers at all"])
      expect(vetText(t, facts)).toMatchObject({ ok: true });
  });
  it("rejects anything else, and reports the offenders", () => {
    expect(vetText("expect 1,200 tickets at $25", [0.87, 238])).toEqual({ ok: false, text: "expect 1,200 tickets at $25", offending: ["1,200", "25"] });
    expect(vetText("about 250 miles", [238]).ok).toBe(false); // 5% off: not rounding
    expect(vetText("fan heat 95", [0.874]).ok).toBe(false);
  });
  it("expands 0-1 scores to percentages and large counts to thousands/millions", () => {
    expect(allowedForms([0.5, 25_000])).toEqual([0.5, 50, 25_000, 25, 0.025]);
  });
});

describe("Fill the gaps: code decides, the model explains", () => {
  it("drops model text with invented numbers, keeps the deterministic explanation, and warns", async () => {
    const p = plan<FillPlan>(await run((name, a) => name === "submit_fill"
      ? { summary: "This routing will sell 4,000 tickets.", fills: (a.fills as { city: string }[]).map((f) => ({ city: f.city, note: "Sells out a 900-cap room.", promo: [] })) }
      : a));
    expect(p.aiSummary).toBeUndefined();
    expect(p.summary).toMatch(/off days filled/);
    expect(p.stops.length).toBeGreaterThan(0);
    for (const s of p.stops) { expect(s.aiNote).toBeUndefined(); expect(s.why).toMatch(/road mi .* \(OSRM\)/); }
    expect(p.warnings.filter((w) => w.startsWith("AI text dropped"))).toHaveLength(p.stops.length + 1);
    expect(p.warnings.join(" ")).toMatch(/4,000/);
  });

  it("keeps model text whose numbers all come from the data, labelled as AI text", async () => {
    const p = plan<FillPlan>(await run((_, a) => a));
    expect(p.aiSummary).toBeTruthy();
    expect(p.stops.every((s) => !!s.aiNote)).toBe(true);
    expect(p.warnings).toEqual([]);
  });

  it("allows the numbers each stop displays: venue radius, touring rules, night weights, onward leg, neighbourhood heat", async () => {
    const base = plan<FillPlan>(await run((_, a) => a));
    const cal = base.result.calendar;
    const noteFor = (city: string) => {
      const i = cal.findIndex((d) => d.kind === "fill" && d.city === city);
      const next = cal.slice(i + 1).find((d) => d.kind !== "off");
      const s = base.stops.find((x) => x.city === city)!;
      const hood = s.neighborhoods?.[0];
      return `${s.city}: ${findCity(city)?.venues.total ?? 0} rooms within 10 mi; ${next?.driveMi} mi and ${next?.driveHours} h on to the next show. `
        + `Inside the ${RULE_VALUES.maxDriveMi} mi / ${RULE_VALUES.maxDriveHours} h caps, at most ${RULE_VALUES.maxConsecutiveShows} shows in a row, clear of the ${RULE_VALUES.radiusMi} mi radius; `
        + `${base.stops[0]!.dow === "Sat" ? "Saturday" : "night"} weight ${RULE_VALUES.dowWeights[6]}${hood ? `, ${hood.name} at ${Math.round(hood.affinity * 100)}` : ""}.`;
    };
    const p = plan<FillPlan>(await run((name, a) => name === "submit_fill"
      ? { ...a, fills: (a.fills as { city: string }[]).map((f) => ({ city: f.city, note: noteFor(f.city), promo: [] })) }
      : a));
    expect(p.warnings.filter((w) => w.startsWith("AI text dropped for") && !w.includes("summary"))).toEqual([]);
    expect(p.stops.every((s) => !!s.aiNote)).toBe(true);
  });

  it("still drops invented numbers next to allowed ones (a 4,321-cap room, a 37 mi gap, a 9.7 h leg)", async () => {
    const p = plan<FillPlan>(await run((name, a) => name === "submit_fill"
      ? { ...a, fills: (a.fills as { city: string }[]).map((f) => ({ city: f.city, note: `Within 10 mi, a 4,321-cap room; 37 mi from the anchor; 9.7 h drive.`, promo: [] })) }
      : a));
    for (const s of p.stops) expect(s.aiNote).toBeUndefined();
    const w = p.warnings.filter((x) => x.startsWith("AI text dropped for") && !x.includes("summary"));
    expect(w).toHaveLength(p.stops.length);
    for (const x of w) { expect(x).toMatch(/4,321/); expect(x).toMatch(/\b37\b/); expect(x).toMatch(/9\.7/); expect(x).not.toMatch(/\(10[,)]/); }
  });

  it("support act, rooms and promo partners are the top Qloo results, whatever the model says", async () => {
    const p = plan<FillPlan>(await run((name, a) => name === "submit_fill" ? { ...a, fills: [] } : a)); // model writes nothing
    expect(p.stops.length).toBeGreaterThan(0);
    for (const s of p.stops) {
      expect(s.support).toHaveLength(1);
      expect(s.venues.length).toBeGreaterThan(0);
      expect(s.promo.every((x) => x.angleBy === "routed")).toBe(true);
      expect(s.aiNote).toBeUndefined();
    }
  });

  it("fetches city intel itself when the model skips get_city_intel", async () => {
    const ev = await run((name, a) => (name === "get_city_intel" ? null : a));
    const p = plan<FillPlan>(ev);
    const auto = ev.filter((e) => e.type === "tool" && e.name === "get_city_intel");
    expect(auto).toHaveLength(p.stops.length);
    expect(auto.every((e) => e.type === "tool" && /fetched by Fanpoint/.test(e.summary))).toBe(true);
    expect(p.stops.every((s) => s.support.length === 1)).toBe(true);
  });

  it("ignores a model-chosen corridor width", async () => {
    const ev = await run((name, a) => (name === "scan_corridor" ? { ...a, buffer_mi: 400 } : a));
    const p = plan<FillPlan>(ev);
    const want = corridor(findCity("New York")!, findCity("Durham")!, RULE_VALUES.corridorBufferMi).wkt;
    expect(p.qlooCalls.find((c) => c.params["filter.location"]?.startsWith("POLYGON"))?.params["filter.location"]).toBe(want);
  });

  it("applies the user's rule overrides (hours, consecutive shows)", async () => {
    const strict = plan<FillPlan>(await collect(runAgent({ ...DEMO, rules: { maxConsecutiveShows: 2, maxDriveHours: 4 } }, { qloo: new MockQlooClient([0, 0]), llm: new MockLlmClient(0) })));
    expect(strict.params).toMatchObject({ maxConsecutiveShows: 2, maxDriveHours: 4 });
    expect(strict.result.longestRun).toBeLessThanOrEqual(2);
    for (const s of strict.stops) expect(s.driveHours! / s.driveDays).toBeLessThanOrEqual(4.05);
  });
});

describe("Co-headline: the ranking decides who is recommended", () => {
  const COHEAD = { task: "cohead" as const, artist: "Marigold Static" };
  it("recommends the top 3 positive scores even if the model only pitches the lowest-ranked peer", async () => {
    const p = plan<CoheadPlan>(await run((name, a) => {
      if (name !== "submit_cohead") return a;
      const pitches = a.pitches as { peer_id: string; pitch: string }[];
      return { summary: "", pitches: pitches.slice(-1) };
    }, COHEAD));
    const expected = p.peers.filter((x, i) => x.score > 0 && i < 3).map((x) => x.entity.id);
    expect(p.peers.filter((x) => x.picked).map((x) => x.entity.id)).toEqual(expected);
    expect(p.summary).toMatch(/Best co-headline by fan-geography coverage/);
  });

  it("compares every peer, even when the model asks for a subset", async () => {
    const p = plan<CoheadPlan>(await run((name, a) => (name === "compare_fan_geography" ? { ...a, peer_ids: [] } : a), COHEAD));
    expect(p.peers.length).toBeGreaterThan(3);
  });

  it("drops a pitch that invents numbers", async () => {
    const p = plan<CoheadPlan>(await run((name, a) => name === "submit_cohead"
      ? { ...a, pitches: (a.pitches as { peer_id: string }[]).map((x) => ({ peer_id: x.peer_id, pitch: "Together you'd draw 12,000 a night." })) }
      : a, COHEAD));
    expect(p.peers.every((x) => x.pitch === undefined)).toBe(true);
    expect(p.warnings.some((w) => /AI pitch dropped.*12,000/.test(w))).toBe(true);
  });
});
