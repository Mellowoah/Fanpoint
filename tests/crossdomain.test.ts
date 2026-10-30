/** "Fans here also like": Qloo cross-domain taste per filled city, fetched in code after the routing. */
import { describe, expect, it } from "vitest";
import { runAgent } from "@/lib/agent/run";
import { Registry, Tools, tourAlsoLike } from "@/lib/agent/tools";
import type { AgentEvent, AlsoLike, FillPlan, FillRequest } from "@/lib/agent/types";
import { MockQlooClient } from "@/lib/qloo/mock-client";
import { MockLlmClient } from "@/lib/llm/mock";
import { ProviderError, type ErrorCode } from "@/lib/net/errors";
import { normalize } from "@/lib/qloo/normalize";
import type { Entity, QlooParams } from "@/lib/qloo/types";
import { MAX_HOOKS, sponsorHooks } from "@/lib/client/sponsor-hooks";
import type { FillStop } from "@/lib/agent/types";
import { DINING_TAG, isFashionBrand, isFoodDrink, XD_CALL_CEILING, XD_FETCH, XD_META, XD_ORDER } from "@/lib/qloo/crossdomain";

const DEMO: FillRequest = {
  task: "fill", artist: "Marigold Static", maxDriveMi: 350, minAffinity: 0.6,
  anchors: [{ city: "New York", date: "2026-11-13", label: "Record release" }, { city: "Durham", date: "2026-11-21" }, { city: "Atlanta", date: "2026-11-28" }],
};
async function collect(gen: AsyncGenerator<AgentEvent>) { const ev: AgentEvent[] = []; for await (const e of gen) ev.push(e); return ev; }
const planOf = (ev: AgentEvent[]) => ev.find((e): e is Extract<AgentEvent, { type: "result" }> => e.type === "result")?.plan as FillPlan | undefined;

/** Mock Qloo that fails chosen insights calls and counts calls per filter.type. */
class Flaky extends MockQlooClient {
  readonly byType = new Map<string, number>();
  constructor(private failWhen: (p: QlooParams) => ErrorCode | undefined) { super([0, 0]); }
  override async insights(p: QlooParams) {
    const t = `${p["filter.type"]}${p["filter.tags"] === DINING_TAG ? "+dining" : ""}`;
    this.byType.set(t, (this.byType.get(t) ?? 0) + 1);
    const c = this.failWhen(p);
    if (c) throw new ProviderError("qloo", c, "injected");
    return super.insights(p);
  }
}

async function artistTools(q: MockQlooClient) {
  const reg = new Registry();
  const t = new Tools(q, reg);
  const r = await t.call("resolve_artist", { name: "Marigold Static" });
  const id = (r.out as { artist: { id: string } }).artist.id;
  return { reg, t, id };
}

describe("cross-domain taste (Fans here also like)", () => {
  it("adds a per-stop panel and a trace step without extra model turns", async () => {
    const llm = new MockLlmClient(0);
    const ev = await collect(runAgent(DEMO, { qloo: new MockQlooClient([0, 0]), llm }));
    const plan = planOf(ev)!;
    expect(plan.warnings).toEqual([]);
    const xd = ev.filter((e): e is Extract<AgentEvent, { type: "tool" }> => e.type === "tool" && e.name === "cross_domain");
    expect(xd).toHaveLength(1);
    expect(xd[0]!.qlooCalls.length).toBe(plan.stops.length * XD_FETCH.length);
    for (const s of plan.stops) {
      const keys = (s.alsoLike ?? []).map((r) => r.key);
      expect(keys).toEqual(XD_ORDER.filter((k) => keys.includes(k))); // display order
      for (const k of ["dining", "tv", "film", "books", "games", "people", "travel"] as const) expect(keys).toContain(k);
      for (const r of s.alsoLike!) {
        expect(r.items.length).toBeGreaterThan(0);
        expect(r.items.length).toBeLessThanOrEqual(3);
        expect(r.items.every((e) => e.mock)).toBe(true);
      }
      // Travel never suggests the stop itself.
      expect(s.alsoLike!.find((r) => r.key === "travel")!.items.some((e) => e.name === s.city)).toBe(false);
    }
    expect(plan.crossDomain?.status.dining).toBe("data");
    expect(plan.crossDomain?.status.brands).toBe("data");
    // Every item shown is a Qloo result the trace recorded (registered entity).
    expect(plan.qlooCalls.length).toBe(ev.filter((e): e is Extract<AgentEvent, { type: "tool" }> => e.type === "tool").reduce((n, t) => n + t.qlooCalls.length, 0));
  });

  it("asks a forbidden category once, drops it for the rest of the run, and keeps the plan", async () => {
    const q = new Flaky((p) => (p["filter.type"] === "urn:entity:book" ? "forbidden" : p["filter.type"] === "urn:entity:videogame" ? "bad_request" : undefined));
    const ev = await collect(runAgent(DEMO, { qloo: q, llm: new MockLlmClient(0) }));
    const plan = planOf(ev)!;
    expect(plan.stops.length).toBeGreaterThan(1);
    expect(q.byType.get("urn:entity:book")).toBe(1);
    expect(q.byType.get("urn:entity:videogame")).toBe(1);
    expect(plan.crossDomain?.status.books).toBe("not enabled for this key");
    expect(plan.crossDomain?.status.games).toBe("failed");
    for (const s of plan.stops) expect(s.alsoLike!.some((r) => r.key === "books" || r.key === "games")).toBe(false);
    expect(plan.warnings).toEqual([]); // silent: the panel only shows fewer categories
  });

  it("never fails the run, even on errors that are fatal elsewhere (rate limit)", async () => {
    const q = new Flaky((p) => (p["filter.type"] === "urn:entity:movie" ? "rate_limited" : undefined));
    const ev = await collect(runAgent(DEMO, { qloo: q, llm: new MockLlmClient(0) }));
    expect(ev.some((e) => e.type === "error")).toBe(false);
    const plan = planOf(ev)!;
    expect(plan.stops.every((s) => !s.alsoLike?.some((r) => r.key === "film"))).toBe(true);
    // After a rate limit every extra category stops (only the first city probed them).
    expect(q.byType.get("urn:entity:tv_show")).toBe(1);
  });

  it("stops before the per-run Qloo call cap", async () => {
    const q = new MockQlooClient([0, 0]);
    const { reg, t, id } = await artistTools(q);
    while (q.calls.length < XD_CALL_CEILING - XD_FETCH.length - 1) q.calls.push({ endpoint: "/x", params: {}, ms: 0, status: "cache", resultCount: 0 });
    const r = await t.crossDomain(id, ["Richmond", "Charlotte", "Baltimore"]);
    expect(q.calls.length).toBeLessThanOrEqual(XD_CALL_CEILING);
    expect(reg.alsoLike.has("richmond")).toBe(true);
    expect(reg.alsoLike.has("charlotte")).toBe(false);
    expect(reg.warnings.some((w) => w.includes("call cap"))).toBe(true);
    expect((r.out as { cities: number }).cities).toBe(3);
  });

  it("restaurants are asked for with Qloo's restaurant tag inside the stop's area", async () => {
    const q = new MockQlooClient([0, 0]);
    const { t, id } = await artistTools(q);
    await t.crossDomain(id, ["Richmond"]);
    const dining = q.calls.find((c) => c.params["filter.tags"] === DINING_TAG)!;
    expect(dining.params["filter.type"]).toBe("urn:entity:place");
    expect(dining.params["filter.location"]).toMatch(/^POINT\(/);
    const tv = q.calls.find((c) => c.params["filter.type"] === "urn:entity:tv_show")!;
    expect(tv.params["signal.location.query"]).toBe("Richmond, VA");
    expect(tv.params["signal.interests.entities"]).toBe(id);
  });
});

describe("tour-wide view and labels", () => {
  const e = (id: string): Entity => ({ id, name: id, kind: "tv_show", tags: [], mock: true });
  it("lists only picks seen in two or more cities, most cities first", () => {
    const by = new Map<string, AlsoLike[]>([
      ["a", [{ key: "tv", items: [e("x"), e("y")] }]],
      ["b", [{ key: "tv", items: [e("x"), e("z")] }]],
      ["c", [{ key: "tv", items: [e("x"), e("y")] }]],
    ]);
    const t = tourAlsoLike(["A", "B", "C"], by);
    expect(t).toEqual([{ key: "tv", items: [{ entity: e("x"), cities: ["A", "B", "C"] }, { entity: e("y"), cities: ["A", "C"] }] }]);
  });
  it("keeps only food-and-drink places under Food & drink (live restaurant-tag results were loose)", () => {
    for (const c of ["restaurant", "cafe", "food_court", "cocktail_bar", "brewery", "sandwich_shop", "tea_house", "bar", "pizzeria", "ice_cream_shop", "american"]) expect(isFoodDrink(c, c === "american" ? "American restaurant" : undefined)).toBe(true);
    for (const c of ["hotel", "golf_course", "truck_stop", "tourist_attraction", "performing_arts_theater", "live_music_venue", "live_music_bar", "farm", "shopping_mall", "recording_studio", "public_library", "ice_rink", "food_bank", "barber_shop"]) expect(isFoodDrink(c, c.replace(/_/g, " "))).toBe(false);
    expect(isFoodDrink(undefined)).toBe(false);
  });
  it("marks fashion brands only from Qloo's own tags", () => {
    expect(isFashionBrand(["Streetwear"])).toBe(true);
    expect(isFashionBrand(["Vintage Clothing"])).toBe(true);
    expect(isFashionBrand(["Coffee Roaster"])).toBe(false);
  });
  it("has plain-English wording for every category, and normalizes the new Qloo types", () => {
    for (const k of XD_ORDER) { expect(XD_META[k].label.length).toBeGreaterThan(0); expect(XD_META[k].use).not.toMatch(/affinity|urn:/i); }
    expect(normalize({ entity_id: "1", name: "B", types: ["urn:entity:book"] } as never).kind).toBe("book");
    expect(normalize({ entity_id: "1", name: "P", types: ["urn:entity:person"] } as never).kind).toBe("person");
    expect(normalize({ entity_id: "1", name: "G", types: ["urn:entity:videogame"] } as never).kind).toBe("videogame");
  });
});

describe("Sponsor & Ad Opportunities hooks", () => {
  const ent = (id: string, kind: Entity["kind"], affinity?: number): Entity => ({ id, name: `N${id}`, kind, affinity } as Entity);
  const stop = (promo: FillStop["promo"], alsoLike: AlsoLike[]): FillStop => ({ promo, alsoLike } as unknown as FillStop);

  it("dedupes by entity id (promo angle kept), sorts by affinity, caps at 4, brands and podcasts only", () => {
    const s = stop(
      [{ entity: ent("b1", "brand", 0.7), angle: "AI idea", angleBy: "ai" }, { entity: ent("t1", "tv_show" as Entity["kind"], 0.99), angle: "tv", angleBy: "routed" }],
      [
        { key: "brands", items: [ent("b1", "brand", 0.7), ent("b2", "brand", 0.9), ent("b3", "brand")] },
        { key: "podcasts", items: [ent("p1", "podcast", 0.8), ent("p2", "podcast", 0.6), ent("b2", "brand", 0.9)] },
        { key: "tv", items: [ent("t2", "tv_show" as Entity["kind"], 0.95)] },
      ],
    );
    const h = sponsorHooks(s);
    expect(h.map((x) => x.entity.id)).toEqual(["b2", "p1", "b1", "p2"]);
    expect(new Set(h.map((x) => x.entity.id)).size).toBe(h.length);
    expect(h.length).toBeLessThanOrEqual(MAX_HOOKS);
    const b1 = h.find((x) => x.entity.id === "b1")!;
    expect(b1).toMatchObject({ angle: "AI idea", angleBy: "ai" });
    expect(h.find((x) => x.entity.id === "b2")).toMatchObject({ angle: XD_META.brands.use, angleBy: "code" });
  });

  it("items without affinity go last in their original order; empty stop gives no hooks", () => {
    const s = stop([], [{ key: "brands", items: [ent("x", "brand"), ent("y", "brand"), ent("z", "brand", 0.5)] }]);
    expect(sponsorHooks(s).map((x) => x.entity.id)).toEqual(["z", "x", "y"]);
    expect(sponsorHooks(stop([], []))).toEqual([]);
    expect(sponsorHooks({ promo: [] } as unknown as FillStop)).toEqual([]);
  });

  it("on a full mock run every stop's hooks are unique and drawn from that stop's promo or cross-domain data", async () => {
    const q = planOf(await collect(runAgent(DEMO, { qloo: new MockQlooClient([0, 0]), llm: new MockLlmClient(0) })))!;
    for (const s of q.stops) {
      const h = sponsorHooks(s);
      const ids = h.map((x) => x.entity.id);
      expect(new Set(ids).size).toBe(ids.length);
      const pool = new Set([...s.promo.map((p) => p.entity.id), ...(s.alsoLike ?? []).flatMap((r) => r.items.map((e) => e.id))]);
      for (const id of ids) expect(pool.has(id)).toBe(true);
      const aff = h.map((x) => x.entity.affinity ?? -1);
      expect([...aff].sort((a, b) => b - a)).toEqual(aff);
    }
  });
});
