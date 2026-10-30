import { describe, expect, it } from "vitest";
import { runAgent } from "@/lib/agent/run";
import type { AgentEvent, FillPlan, FillRequest, FillStop } from "@/lib/agent/types";
import type { Entity } from "@/lib/qloo/types";
import { MockQlooClient } from "@/lib/qloo/mock-client";
import { MockLlmClient } from "@/lib/llm/mock";
import {
  LIMITS, NOTICE, PACK_CSV_HEADER, PLATFORMS, STATUS, budgetTotal, buildAdPack, charCount, csvCell, fit, mapInterest, minusDays,
  packText, packsCsv, packsJson, sensitiveReason, stopInterests, xLength,
} from "@/lib/client/ad-packs";

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
const ent = (id: string, name: string, kind: Entity["kind"], affinity?: number, tags: string[] = []): Entity => ({ id, name, kind, affinity, tags, mock: true });

describe("sensitive-category filter", () => {
  it.each([
    ["The Bible in a Year", [], "religion"], ["Pod Save America", ["Politics"], "politics"], ["Calm Mind", ["Mental Health"], "health"],
    ["Queer Eye", [], "sexual orientation or gender identity"], ["Latino USA", [], "race or ethnicity"], ["Debt Free Living", [], "personal finances"],
    ["Tito's Handmade Vodka", ["Spirits"], "age-restricted product"], ["Sierra Nevada", ["Beer", "Brewery"], "age-restricted product"],
  ])("drops %s (%s)", (name, tags, reason) => {
    expect(sensitiveReason({ name, tags, kind: "brand" })).toBe(reason);
  });
  it.each([["Patagonia", ["Outdoor apparel"]], ["Black Sabbath", ["Metal"]], ["God of War", ["Action"]], ["Money Heist", ["Drama"]], ["Latin Grammys", []], ["Progressive Rock Weekly", []]])("keeps %s", (name, tags) => {
    expect(sensitiveReason({ name, tags, kind: "brand" })).toBeUndefined();
  });
  it("checks a person's description (politicians)", () => {
    expect(sensitiveReason({ name: "Jane Doe", tags: [], kind: "person", description: "American politician and senator" })).toBe("politics");
  });
});

describe("interest mapping", () => {
  it("maps a Qloo name to each platform's keyword style", () => {
    const m = mapInterest("  The  Bear ", "tv");
    expect(m).toEqual({ meta: "The Bear", x: '"the bear"', snap: "TV fans (The Bear)" });
    expect(mapInterest("Aritzia", "brands", { kind: "brand", tags: ["Fashion"] }).snap).toMatch(/^fashion & style/);
  });
  it("keeps the artist first, sorts by affinity, dedupes, skips dining and drops sensitive picks with a reason", async () => {
    const q = await demoPlan();
    const s0 = q.stops[0]!;
    const s: FillStop = {
      ...s0, support: [], promo: [{ entity: ent("b1", "Glossier", "brand", 0.7), angle: "x", angleBy: "routed" }],
      alsoLike: [
        { key: "brands", items: [ent("b1", "Glossier", "brand", 0.7), ent("b2", "Jack Daniel's", "brand", 0.99, ["Whiskey"])] },
        { key: "tv", items: [ent("t1", "The Bear", "tv_show", 0.9)] },
        { key: "dining", items: [ent("d1", "Joe's Pizza", "place", 0.95)] },
        { key: "podcasts", items: [ent("p1", "Church Talk", "podcast", 0.8)] },
      ],
    };
    const { interests, excluded } = stopInterests(q, s);
    expect(interests.map((i) => i.name)).toEqual([q.artist.name, "The Bear", "Glossier"]);
    expect(interests[1]).toMatchObject({ source: "tv", rank: 1, affinity: 90, entityId: "t1" });
    expect(excluded.map((e) => [e.name, e.reason])).toEqual([["Jack Daniel's", "age-restricted product"], ["Church Talk", "religion"]]);
    const p = buildAdPack(q, s);
    expect(p.audience.localPartners).toEqual(["Joe's Pizza"]);
    expect(p.hook?.name).toBe("The Bear");
  });
  it("every interest in the demo plan has a Qloo receipt", async () => {
    const q = await demoPlan();
    for (const s of q.stops) for (const i of stopInterests(q, s).interests) { expect(i.entityId).toBeTruthy(); if (i.source !== "music") expect(i.rank).toBeGreaterThan(0); }
  });
});

describe("character limits", () => {
  it("fit picks the first candidate that fits, else cuts at a word with an ellipsis", () => {
    expect(fit(["a long one here", "short"], 6)).toBe("short");
    const cut = fit(["Supercalifragilistic Expialidocious Band"], 25);
    expect([...cut].length).toBeLessThanOrEqual(25); expect(cut.endsWith("…")).toBe(true);
  });
  it("X counts links as 23 and CJK as 2", () => {
    expect(xLength("hi https://example.com/a/very/long/path/that/goes/on")).toBe(3 + 23);
    expect(xLength("東京")).toBe(4);
  });
  it("every generated field is within its limit, including very long names", async () => {
    const q = await demoPlan();
    const long: FillPlan = { ...q, artist: { ...q.artist, name: "The Extraordinarily Long-Named Orchestra of Everything" } };
    for (const plan of [q, long]) for (const s of plan.stops) {
      const p = buildAdPack(plan, s, { ticketUrl: "https://tickets.example.com/event/123456789?utm_source=x" });
      for (const pl of PLATFORMS) for (const c of p.creative[pl]) expect(charCount(c.text, pl), `${pl} ${c.field}: ${c.text}`).toBeLessThanOrEqual(c.limit);
      expect(p.creative.snap.find((c) => c.field === "Headline")!.limit).toBe(LIMITS.snapHeadline);
      expect(p.xIntent.startsWith("https://x.com/intent/post?text=")).toBe(true);
      expect(decodeURIComponent(p.xIntent.split("text=")[1]!)).toBe(p.creative.x[0]!.text);
    }
  });
  it("copy names the show, the city and the Qloo hook; no invented link", async () => {
    const q = await demoPlan();
    const s = q.stops[0]!;
    const p = buildAdPack(q, s);
    const meta = p.creative.meta[0]!.text;
    expect(meta).toContain(q.artist.name);
    expect(meta).toContain(s.city.replace(/,.*$/, ""));
    if (p.hook) expect(p.creative.x[0]!.text).toContain(p.hook.name);
    expect(p.creative.x[0]!.text).not.toMatch(/https?:/);
    expect(buildAdPack(q, s, { ticketUrl: "javascript:alert(1)" }).creative.x[0]!.text).not.toContain("javascript");
  });
  it("audience: 14-day window ending on the show, 18+, draft status and notice", async () => {
    const q = await demoPlan();
    const s = q.stops[0]!;
    const p = buildAdPack(q, s);
    expect(p.audience).toMatchObject({ start: minusDays(s.date, 14), end: s.date, minAge: 18 });
    expect(minusDays("2026-03-10", 14)).toBe("2026-02-24");
    expect(p.status).toBe(STATUS); expect(p.notice).toBe(NOTICE);
  });
});

describe("export", () => {
  it("CSV guard neutralises formulas and quotes", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    for (const v of ["+1", "-2", "@SUM(A1)", "\tcmd"]) expect(csvCell(v).startsWith("'")).toBe(true);
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(undefined)).toBe("");
  });
  it("CSV has the header and one row per platform interest; JSON round-trips; text has every platform", async () => {
    const q = await demoPlan();
    const packs = q.stops.map((s) => buildAdPack(q, s));
    const csv = packsCsv(packs, { daily: 20, days: 14 });
    expect(csv.split("\r\n")[0]).toBe(PACK_CSV_HEADER.join(","));
    const interestRows = csv.split("\r\n").filter((l) => l.includes(",audience,interest,")).length;
    for (const l of csv.trim().split("\r\n")) expect(l.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g)!.length).toBe(PACK_CSV_HEADER.length);
    expect(interestRows).toBe(packs.reduce((t, p) => t + p.audience.interests.length * 3, 0));
    const j = JSON.parse(packsJson(packs, { daily: 20, days: 14 }));
    expect(j.packs).toHaveLength(q.stops.length);
    expect(j.budget).toMatchObject({ totalPerPlatform: 280, note: "Your numbers, not Qloo data" });
    const t = packText(packs[0]!, { daily: 0, days: 14 });
    for (const w of ["META (FACEBOOK + INSTAGRAM)", "X", "SNAPCHAT", NOTICE, "not set"]) expect(t).toContain(w);
    expect(t).not.toMatch(/\\u[0-9a-f]{4}/i);
  });
  it("budget total is daily × days, only when both are set", () => {
    expect(budgetTotal({ daily: 25, days: 14 })).toBe(350);
    expect(budgetTotal({ daily: 0, days: 14 })).toBeUndefined();
    expect(budgetTotal({ daily: 10, days: 0 })).toBeUndefined();
    expect(budgetTotal({ daily: Number.NaN, days: 3 })).toBeUndefined();
  });
});
