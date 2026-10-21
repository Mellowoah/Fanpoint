/** End-to-end agent runs in mock mode (scripted LLM + mock Qloo fixtures), plus injected failures. */
import { describe, expect, it } from "vitest";
import { runAgent } from "@/lib/agent/run";
import { longestShowRun, runPlainFill } from "@/lib/agent/plain";
import type { AgentEvent, CoheadPlan, FillPlan, FillRequest, PlainFillPlan } from "@/lib/agent/types";
import { MockQlooClient } from "@/lib/qloo/mock-client";
import { MockLlmClient } from "@/lib/llm/mock";
import { ProviderError, type ErrorCode } from "@/lib/net/errors";
import type { HeatCell, QlooClient, QlooParams } from "@/lib/qloo/types";
import type { ChatMessage, ChatResult, LlmClient } from "@/lib/llm/types";
import { gcMi } from "@/lib/route/geo";
import { osrmRoads } from "@/lib/route/road";
import { findCity } from "@/lib/route/cities";

const DEMO: FillRequest = {
  task: "fill", artist: "Marigold Static", maxDriveMi: 350, minAffinity: 0.6,
  anchors: [{ city: "New York", date: "2026-11-13", label: "Record release" }, { city: "Durham", date: "2026-11-21" }, { city: "Atlanta", date: "2026-11-28" }],
};
const fast = () => ({ qloo: new MockQlooClient([0, 0]), llm: new MockLlmClient(0) });
async function collect(gen: AsyncGenerator<AgentEvent>) { const ev: AgentEvent[] = []; for await (const e of gen) ev.push(e); return ev; }
const result = <T,>(ev: AgentEvent[]) => ev.find((e): e is Extract<AgentEvent, { type: "result" }> => e.type === "result")?.plan as T | undefined;
const error = (ev: AgentEvent[]) => ev.find((e): e is Extract<AgentEvent, { type: "error" }> => e.type === "error");

/** Mock Qloo that fails chosen calls. */
class FlakyQloo extends MockQlooClient {
  constructor(private failWhen: (kind: "heatmap" | "insights" | "search" | "tags", p: QlooParams) => ErrorCode | undefined) { super([0, 0]); }
  override async heatmap(p: QlooParams): Promise<HeatCell[]> { const c = this.failWhen("heatmap", p); if (c) throw new ProviderError("qloo", c, "injected"); return super.heatmap(p); }
  override async insights(p: QlooParams) { const c = this.failWhen("insights", p); if (c) throw new ProviderError("qloo", c, "injected"); return super.insights(p); }
  override async search(q: string, t: string[], n?: number) { const c = this.failWhen("search", { q }); if (c) throw new ProviderError("qloo", c, "injected"); return super.search(q, t, n); }
}

describe("Fill the gaps, mock mode", () => {
  it("runs end to end: anchors in, grounded fills with drive times out", async () => {
    const ev = await collect(runAgent(DEMO, fast()));
    expect(error(ev)).toBeUndefined();
    const plan = result<FillPlan>(ev)!;
    expect(plan.providers).toEqual({ qloo: "mock", llm: "mock", model: "scripted-mock" });
    expect(plan.result.offBefore).toBe(13);
    expect(plan.result.fills).toBeGreaterThan(0);
    expect(plan.stops).toHaveLength(plan.result.fills);
    expect(plan.grounding.dropped).toEqual([]);
    expect(plan.grounding.grounded).toBe(plan.grounding.referenced);
    expect(plan.warnings).toEqual([]);
    expect(plan.corridors.map((c) => `${c.from}>${c.to}`)).toEqual(["New York>Durham", "Durham>Atlanta"]);
    expect(plan.corridors.every((c) => c.source === "heatmap")).toBe(true);
    // Rules hold on the final plan.
    for (const s of plan.stops) {
      expect(s.driveMi / s.driveDays).toBeLessThanOrEqual(350.5);
      expect(s.driveHours! / s.driveDays).toBeLessThanOrEqual(plan.params.maxDriveHours! + 0.05);
      expect(s.run!).toBeLessThanOrEqual(plan.params.maxConsecutiveShows!);
      for (const a of plan.anchors) expect(gcMi(a, s)).toBeGreaterThanOrEqual(60);
      expect(s.affinity).toBeGreaterThanOrEqual(0.6);
    }
    expect(plan.result.maxDayDrive).toBeLessThanOrEqual(350);
  });

  it("streams a trace in which every ranking tool lists its own Qloo calls", async () => {
    const ev = await collect(runAgent(DEMO, fast()));
    const tools = ev.filter((e): e is Extract<AgentEvent, { type: "tool" }> => e.type === "tool");
    expect(tools.map((t) => t.name).slice(0, 4)).toEqual(["resolve_artist", "scan_corridor", "scan_corridor", "fill_gaps"]);
    const scans = tools.filter((t) => t.name === "scan_corridor");
    for (const s of scans) {
      expect(s.qlooCalls).toHaveLength(1);
      expect(s.qlooCalls[0]?.params["filter.type"]).toBe("urn:heatmap");
      expect(s.qlooCalls[0]?.params["filter.location"]).toMatch(/^POLYGON\(\(/);
    }
    expect(tools.find((t) => t.name === "fill_gaps")?.qlooCalls).toEqual([]); // computed in code, no Qloo call
    const plan = result<FillPlan>(ev)!;
    expect(plan.qlooCalls.length).toBe(tools.reduce((n, t) => n + t.qlooCalls.length, 0));
    expect(ev.filter((e) => e.type === "step" && e.status === "done").length).toBeGreaterThan(3);
  });

  it("is deterministic in mock mode", async () => {
    const a = result<FillPlan>(await collect(runAgent(DEMO, fast())))!;
    const b = result<FillPlan>(await collect(runAgent(DEMO, fast())))!;
    expect(a.result.calendar).toEqual(b.result.calendar);
  });

  it("the max-drive rule comes from the request, not the model", async () => {
    // A model that asks fill_gaps for 500 mi/day when the user said 300.
    class Greedy extends MockLlmClient {
      override async chat(m: ChatMessage[], t: Parameters<MockLlmClient["chat"]>[1]): Promise<ChatResult> {
        const r = await super.chat(m, t);
        return { ...r, toolCalls: r.toolCalls.map((c) => (c.function.name === "fill_gaps" ? { ...c, function: { ...c.function, arguments: '{"max_drive_mi":500}' } } : c)) };
      }
    }
    const plan = result<FillPlan>(await collect(runAgent({ ...DEMO, maxDriveMi: 300 }, { qloo: new MockQlooClient([0, 0]), llm: new Greedy(0) })))!;
    expect(plan.params.maxDriveMi).toBe(300);
    expect(plan.result.maxDayDrive).toBeLessThanOrEqual(300);
  });

  it("degrades to the destination fallback when a corridor heatmap fails", async () => {
    let first = true;
    const qloo = new FlakyQloo((k) => { if (k === "heatmap" && first) { first = false; return "upstream"; } return undefined; });
    const ev = await collect(runAgent(DEMO, { qloo, llm: new MockLlmClient(0) }));
    const plan = result<FillPlan>(ev)!;
    expect(plan.corridors[0]?.source).toBe("destination");
    expect(plan.warnings.join(" ")).toMatch(/Fan heatmap for New York → Durham.*server error/);
    expect(plan.result.fills).toBeGreaterThan(0);
    expect(qloo.calls.some((c) => c.params["filter.type"] === "urn:entity:destination")).toBe(true);
  });

  it("leaves a corridor's days open (with a warning) when heatmap and fallback both fail", async () => {
    const qloo = new FlakyQloo((k, p) => (String(p["filter.location"] ?? "").startsWith("POLYGON") && (k === "heatmap" || k === "insights") ? "timeout" : undefined));
    const plan = result<FillPlan>(await collect(runAgent(DEMO, { qloo, llm: new MockLlmClient(0) })))!;
    expect(plan.corridors.every((c) => c.source === "none")).toBe(true);
    expect(plan.result.fills).toBe(0);
    expect(plan.result.offAfter).toBe(13);
    expect(plan.warnings.some((w) => /No Qloo fan data/.test(w))).toBe(true);
  });

  it("a failing city-intel sub-call costs only that list", async () => {
    const qloo = new FlakyQloo((k, p) => (k === "insights" && p["filter.type"] === "urn:entity:podcast" ? "invalid_response" : undefined));
    const plan = result<FillPlan>(await collect(runAgent(DEMO, { qloo, llm: new MockLlmClient(0) })))!;
    expect(plan.stops.length).toBeGreaterThan(0);
    expect(plan.stops.every((s) => s.venues.length > 0 && s.promo.every((p) => p.entity.kind !== "podcast"))).toBe(true);
    expect(plan.warnings.some((w) => /podcasts: Qloo returned data in an unexpected format/.test(w))).toBe(true);
  });

  it("a Qloo 403 on one entity type (not enabled for the key) degrades that list instead of killing the run", async () => {
    const qloo = new FlakyQloo((k, p) => (k === "insights" && p["filter.type"] === "urn:entity:destination" ? "forbidden" : k === "heatmap" ? "upstream" : undefined));
    const ev = await collect(runAgent(DEMO, { qloo, llm: new MockLlmClient(0) }));
    expect(error(ev)).toBeUndefined();
    const plan = result<FillPlan>(ev)!;
    expect(plan.corridors.every((c) => c.source === "none")).toBe(true);
    expect(plan.warnings.some((w) => /HTTP 403.*not enabled/.test(w))).toBe(true);
  });

  it("an untrusted QLOO_BASE_URL is refused before any request, as a config error", async () => {
    const qloo = new FlakyQloo(() => "config");
    const ev = await collect(runAgent(DEMO, { qloo, llm: new MockLlmClient(0) }));
    expect(result(ev)).toBeUndefined();
    expect(error(ev)).toMatchObject({ code: "config", provider: "qloo", retryable: false });
  });

  it("a fatal Qloo error (bad key) ends the run with a clear, typed error", async () => {
    const qloo = new FlakyQloo((k) => (k === "heatmap" ? "auth" : undefined));
    const ev = await collect(runAgent(DEMO, { qloo, llm: new MockLlmClient(0) }));
    expect(result(ev)).toBeUndefined();
    expect(error(ev)).toMatchObject({ code: "auth", provider: "qloo", retryable: false, message: expect.stringMatching(/QLOO_API_KEY/) });
  });

  it("rate limited after retries: fatal, but marked retryable for the UI", async () => {
    const ev = await collect(runAgent(DEMO, { qloo: new FlakyQloo((k) => (k === "search" ? "rate_limited" : undefined)), llm: new MockLlmClient(0) }));
    expect(error(ev)).toMatchObject({ code: "rate_limited", retryable: true });
  });
});

describe("Co-headliner match, mock mode", () => {
  it("ranks by complementarity; the most similar act ranks below the best complement", async () => {
    const ev = await collect(runAgent({ task: "cohead", artist: "Marigold Static", partner: "Saltwater Hymnal (mock)" }, fast()));
    expect(error(ev)).toBeUndefined();
    const plan = result<CoheadPlan>(ev)!;
    const scores = plan.peers.map((p) => p.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const mostSimilar = [...plan.peers].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))[0]!;
    expect(mostSimilar.entity.name).toMatch(/Low Tide Choir/);
    expect(mostSimilar.score).toBeLessThan(plan.peers[0]!.score);
    expect(mostSimilar.overlap.length).toBeGreaterThan(mostSimilar.youGain.length);
    const partner = plan.peers.find((p) => p.requested)!;
    expect(partner.entity.name).toBe("Saltwater Hymnal (mock)");
    expect(partner.pitch).toBeTruthy();
    expect(plan.peers.filter((p) => p.picked).every((p) => p.score > 0)).toBe(true);
    for (const p of plan.peers) { expect(p.newStrongForYou).toBeGreaterThanOrEqual(0); expect(p.coveredStrong).toBe(p.youStrong + p.newStrongForYou); }
    expect(plan.cities.length).toBeGreaterThan(50);
    expect(plan.grounding.dropped).toEqual([]);
  });

  it("every heatmap request in the trace is a lower-48 polygon", async () => {
    const ev = await collect(runAgent({ task: "cohead", artist: "Marigold Static" }, fast()));
    const geo = ev.find((e): e is Extract<AgentEvent, { type: "tool" }> => e.type === "tool" && e.name === "compare_fan_geography")!;
    expect(geo.qlooCalls.length).toBeGreaterThan(2);
    expect(geo.qlooCalls.every((c) => c.params["filter.type"] === "urn:heatmap" && c.params["filter.location"]?.startsWith("POLYGON((-125 24.5"))).toBe(true);
  });

  it("a peer whose heatmap fails is skipped with a warning", async () => {
    const qloo = new FlakyQloo((k, p) => (k === "heatmap" && String(p["signal.interests.entities"]).includes("velvet") ? "upstream" : undefined));
    const plan = result<CoheadPlan>(await collect(runAgent({ task: "cohead", artist: "Marigold Static" }, { qloo, llm: new MockLlmClient(0) })))!;
    expect(plan.peers.some((p) => /Velvet/.test(p.entity.name))).toBe(false);
    expect(plan.warnings.some((w) => /Velvet Orchard/.test(w))).toBe(true);
  });
});

describe("agent loop guards", () => {
  const scripted = (turns: ChatResult[]): LlmClient => {
    let i = 0;
    return { mode: "mock", model: "test", chat: async () => turns[Math.min(i++, turns.length - 1)]!, json: async () => ({}) };
  };
  const call = (name: string, args: string, id = name) => ({ id, type: "function" as const, function: { name, arguments: args } });

  it("bad tool arguments go back to the model as an error, not a crash", async () => {
    const seen: string[] = [];
    const llm: LlmClient = { mode: "mock", model: "t", json: async () => ({}), chat: async (m) => {
      const tool = m.filter((x) => x.role === "tool").at(-1);
      if (tool) { seen.push(tool.content ?? ""); return { content: "giving up", toolCalls: [] }; }
      return { content: null, toolCalls: [call("scan_corridor", '{"artist_id":42,"from_city":"New York","to_city":"Durham"}')] };
    } };
    const ev = await collect(runAgent(DEMO, { qloo: new MockQlooClient([0, 0]), llm }));
    expect(seen[0]).toMatch(/Invalid arguments for scan_corridor: artist_id/);
    expect(error(ev)).toMatchObject({ code: "agent", message: expect.stringMatching(/stopped without a plan: giving up/) });
  });

  it("unknown tools, non-JSON args and ungrounded ids are all handled", async () => {
    const msgs: string[] = [];
    const llm: LlmClient = { mode: "mock", model: "t", json: async () => ({}), chat: async (m) => {
      msgs.push(...m.filter((x) => x.role === "tool").map((x) => x.content ?? ""));
      return { content: null, toolCalls: [call("constructor", "{}", "a"), call("resolve_artist", "{nope", "b"), call("get_city_intel", '{"artist_id":"made-up","city":"Durham"}', "c")] };
    } };
    const ev = await collect(runAgent(DEMO, { qloo: new MockQlooClient([0, 0]), llm, maxTurns: 2 }));
    const errors = msgs.map((x) => (JSON.parse(x) as { error?: string }).error).join("\n");
    expect(errors).toMatch(/Unknown tool "constructor"/); // regression: prototype keys used to pass the tool lookup
    expect(errors).toMatch(/not valid JSON/);
    expect(errors).toMatch(/Unknown artist_id "made-up"/);
    expect(error(ev)).toMatchObject({ code: "agent", message: expect.stringMatching(/all 2 turns/) });
  });

  it("fill_gaps refuses to run before every corridor is scanned", async () => {
    let out = "";
    const llm: LlmClient = { mode: "mock", model: "t", json: async () => ({}), chat: async (m) => {
      const t = m.find((x) => x.role === "tool"); if (t) { out = t.content ?? ""; return { content: null, toolCalls: [] }; }
      return { content: null, toolCalls: [call("fill_gaps", "{}")] };
    } };
    await collect(runAgent(DEMO, { qloo: new MockQlooClient([0, 0]), llm }));
    expect(out).toMatch(/Missing: New York -> Durham, Durham -> Atlanta/);
  });

  it("submit before any work is rejected back to the model", async () => {
    const outs: string[] = [];
    const llm: LlmClient = { mode: "mock", model: "t", json: async () => ({}), chat: async (m) => {
      outs.push(...m.filter((x) => x.role === "tool").map((x) => x.content ?? ""));
      return outs.length ? { content: "stop", toolCalls: [] } : { content: null, toolCalls: [call("submit_fill", '{"summary":"x","fills":[]}')] };
    } };
    await collect(runAgent(DEMO, { qloo: new MockQlooClient([0, 0]), llm }));
    expect(outs[0]).toMatch(/Call fill_gaps before submit_fill/);
  });

  it("LLM provider errors end the run with the LLM's message", async () => {
    const llm: LlmClient = { mode: "live", model: "t", json: async () => ({}), chat: async () => { throw new ProviderError("llm", "timeout", "x", undefined, 3); } };
    const ev = await collect(runAgent(DEMO, { qloo: new MockQlooClient([0, 0]), llm }));
    expect(error(ev)).toMatchObject({ code: "timeout", provider: "llm", message: expect.stringMatching(/language model did not respond in time after 3 attempts/) });
  });

  it("unexpected exceptions become a generic internal error (no stack traces to the UI)", async () => {
    const broken = { ...new MockQlooClient([0, 0]), mode: "mock", calls: [], search: async () => { throw new Error("secret internals"); } } as unknown as QlooClient;
    const ev = await collect(runAgent(DEMO, { qloo: broken, llm: new MockLlmClient(0) }));
    expect(error(ev)).toMatchObject({ code: "internal" });
    expect(error(ev)?.message).not.toContain("secret internals");
  });

  it("stops at the wall-clock deadline", async () => {
    const ev = await collect(runAgent(DEMO, { qloo: new MockQlooClient([0, 0]), llm: scripted([{ content: null, toolCalls: [call("resolve_artist", '{"name":"x"}')] }]), deadlineMs: -1 }));
    expect(error(ev)).toMatchObject({ code: "timeout" });
  });
});

describe("plain-AI baseline", () => {
  it("simulated answer is audited with the same rules", async () => {
    const ev = await collect(runPlainFill(DEMO, { llm: new MockLlmClient(0) }));
    const p = result<PlainFillPlan>(ev)!;
    expect(p.simulated).toBe(true);
    expect(p.stops.length).toBeGreaterThan(0);
    expect(p.audit.filter((a) => !a.anchor)).toHaveLength(p.stops.length);
    expect(p.audit.some((a) => a.radiusConflict || a.doublesBack)).toBe(true); // the simulation breaks rules, by design
  });
  it("validates the model's answer: malformed stops dropped, unknown cities kept but unmapped", async () => {
    const llm: LlmClient = { mode: "live", model: "t", chat: async () => ({ content: null, toolCalls: [] }), json: async () => ({
      summary: "s", stops: [{ date: "2026-11-15", city: "Philadelphia", venue: "Club" }, { date: "2026-11-16", city: "Atlantis", venue: "Sea" }, { date: "Nov 17", city: "Richmond" }, "junk"],
    }) };
    const p = result<PlainFillPlan>(await collect(runPlainFill(DEMO, { llm })))!;
    expect(p.stops.map((s) => s.city)).toEqual(["Philadelphia", "Atlantis"]);
    expect(p.warnings).toEqual(["2 malformed stop(s) in the plain-AI answer were ignored."]);
    expect(p.audit.find((a) => a.city === "Atlantis")?.mapped).toBe(false);
    expect(p.stops[0]?.why).toBe("");
  });
  it("restated anchors are not counted as fills, and long show runs are flagged", async () => {
    const days = ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
    const cities = ["New York", "Philadelphia", "Washington", "Richmond", "Charlottesville", "Roanoke", "Greensboro", "Raleigh"];
    const llm: LlmClient = { mode: "live", model: "t", chat: async () => ({ content: null, toolCalls: [] }), json: async () => ({
      summary: "s", stops: days.map((date, i) => ({ date, city: cities[i], venue: "v" })),
    }) };
    const p = result<PlainFillPlan>(await collect(runPlainFill(DEMO, { llm })))!;
    expect(p.stops.map((s) => s.city)).not.toContain("New York");
    expect(p.stops).toHaveLength(7);
    expect(p.longestRun).toBe(9); // Nov 13-21, Durham anchor included
    expect(p.warnings).toEqual(["1 stop(s) in the plain-AI answer repeated the fixed shows and were not counted as fills.", "The plain-AI plan has 9 shows in a row (limit 6, then a day off)."]);
  });
  it("accepts a bare stops array or a wrapped object (Gemini JSON mode)", async () => {
    const stop = { date: "2026-11-15", city: "Philadelphia", venue: "Club" };
    for (const answer of [[stop], [{ summary: "s", stops: [stop] }]]) {
      const llm: LlmClient = { mode: "live", model: "t", chat: async () => ({ content: null, toolCalls: [] }), json: async () => answer };
      const p = result<PlainFillPlan>(await collect(runPlainFill(DEMO, { llm })))!;
      expect(p.stops.map((s) => s.city)).toEqual(["Philadelphia"]);
    }
  });
  it("longestShowRun counts consecutive days once each", () => {
    expect(longestShowRun([])).toBe(0);
    expect(longestShowRun(["2026-11-01", "2026-11-02", "2026-11-02", "2026-11-04", "bad"])).toBe(2);
  });
  it("an unusable answer becomes an error event", async () => {
    const llm: LlmClient = { mode: "live", model: "t", chat: async () => ({ content: null, toolCalls: [] }), json: async () => ({ answer: "sorry" }) };
    const ev = await collect(runPlainFill(DEMO, { llm }));
    expect(ev.find((e) => e.type === "step" && e.status === "error")).toBeTruthy();
    expect(error(ev)).toMatchObject({ code: "invalid_response", provider: "llm" });
  });
});

it("drive legs in the plan are the OSRM road legs between the actual cities", async () => {
  const plan = result<FillPlan>(await collect(runAgent(DEMO, fast())))!;
  const roads = osrmRoads();
  for (const s of plan.stops) {
    const leg = roads.legById(findCity(s.prevCity)!.id, s.cityId!)!;
    if (s.driveDays === 1) expect({ mi: s.driveMi, hours: s.driveHours }).toEqual({ mi: Math.round(leg.mi), hours: leg.hours });
    expect(s.driveMi).toBeGreaterThanOrEqual(Math.floor(gcMi(findCity(s.prevCity)!, s) * 0.98));
  }
  expect(plan.routing.engine).toMatch(/OSRM/);
});

describe("toolContent", () => {
  it("passes small results through and replaces oversized ones with valid JSON", async () => {
    const { toolContent } = await import("@/lib/agent/run");
    expect(toolContent({ a: 1 })).toBe('{"a":1}');
    expect(toolContent(undefined)).toBe("null");
    const big = toolContent({ xs: "y".repeat(20000) });
    const parsed = JSON.parse(big) as { truncated: boolean; preview: string };
    expect(parsed.truncated).toBe(true);
    expect(big.length).toBeLessThanOrEqual(12000);
  });
});
