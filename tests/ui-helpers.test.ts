import { beforeEach, describe, expect, it, vi } from "vitest";
import inputs from "../scripts/baseline/inputs.v1.json";
import { MAX_TOUR_DAYS } from "@/lib/api/plan-request";
import { CLIENT_LIMITS, dateBounds, errorCount, hasErrors, validateFill } from "@/lib/client/fill-validate";
import { cityLabel, suggestCities } from "@/lib/client/city-suggest";
import { mockSuggestions, normalizeQuery, resetSuggestBudget, suggestArtists, SUGGEST_LIVE_PER_MINUTE } from "@/lib/api/artist-suggest";
import { cacheClear } from "@/lib/cache";
import { DATE_SETS, DEMO_FILL, demoFill, exampleFill, examples } from "@/components/FillForm";
import { GET } from "@/app/api/artists/route";
import type { QlooClient } from "@/lib/qloo/types";

const ok = { artist: "Japanese Breakfast", anchors: [{ city: "New York", date: "2026-11-13" }, { city: "Durham", date: "2026-11-21" }, { city: "Atlanta", date: "2026-11-28" }] };

describe("inline fill validation", () => {
  it("accepts the demo and mirrors server limits", () => {
    expect(hasErrors(validateFill(ok))).toBe(false);
    expect(CLIENT_LIMITS.maxTourDays).toBe(MAX_TOUR_DAYS);
  });
  it("flags each problem on its own field", () => {
    const e = validateFill({ artist: " ", anchors: [{ city: "New York", date: "2026-11-21" }, { city: "Atlantis", date: "2026-11-13" }, { city: "new york", date: "" }] });
    expect(e.artist).toMatch(/Enter an artist/);
    expect(e.anchors[1]?.city).toMatch(/from the list/);
    expect(e.anchors[2]?.city).toMatch(/Already used for stop 1/);
    expect(e.anchors[2]?.date).toMatch(/Pick a date/);
    expect(errorCount(e)).toBe(4);
  });
  it("checks order, duplicate days and the 45-day span once dates are valid", () => {
    const base = (d: string[]) => validateFill({ artist: "x", anchors: d.map((date, i) => ({ city: ["New York", "Durham", "Atlanta"][i]!, date })) });
    expect(base(["2026-11-21", "2026-11-13"]).anchors[1]?.date).toMatch(/Before stop 1 \(Nov 21\)/);
    expect(base(["2026-11-13", "2026-11-13"]).anchors[1]?.date).toMatch(/Same day as stop 1/);
    expect(base(["2026-11-01", "2026-11-10", "2026-12-31"]).anchors[2]?.date).toMatch(/within 45 days/);
    expect(base(["2026-02-30", "2026-03-05"]).anchors[0]?.date).toMatch(/Not a real date/);
  });
  it("needs 2-4 stops", () => {
    expect(validateFill({ artist: "x", anchors: [{ city: "Durham", date: "2026-11-13" }] }).form).toMatch(/at least 2/);
  });
  it("keeps date pickers wide enough for the fixed demo dates", () => {
    const b = dateBounds(new Date(2027, 5, 1));
    expect(b).toEqual({ min: "2026-06-01", max: "2030-06-01" });
    expect(b.min <= "2026-11-13").toBe(true);
  });
});

describe("city autocomplete", () => {
  it("ranks prefix matches by metro size and labels with the state", () => {
    const r = suggestCities("dur");
    expect(cityLabel(r[0]!)).toBe("Durham, NC");
    expect(suggestCities("portland").map(cityLabel).slice(0, 2)).toEqual(expect.arrayContaining(["Portland, OR"]));
    expect(suggestCities("").length).toBe(8);
    expect(suggestCities("zzzz")).toEqual([]);
  });
});

describe("demo defaults and example chips", () => {
  it("live mode prefills Japanese Breakfast on the east demo anchors; mock keeps Marigold Static", () => {
    expect(demoFill("live")).toMatchObject({ artist: "Japanese Breakfast", anchors: [{ city: "New York", date: "2026-11-13", label: "Record release" }, { city: "Durham", date: "2026-11-21", label: "Festival slot" }, { city: "Atlanta", date: "2026-11-28", label: "Support slot" }] });
    expect(demoFill("mock").artist).toBe("Marigold Static");
    expect(demoFill(undefined)).toBe(DEMO_FILL);
  });
  it("example date sets match the frozen baseline inputs and every example is valid", () => {
    for (const [k, v] of Object.entries(DATE_SETS)) expect(v).toEqual((inputs.dateSets as Record<string, unknown>)[k]);
    for (const m of ["live", "mock"] as const) for (const x of examples(m)) {
      expect(hasErrors(validateFill(exampleFill(x)))).toBe(false);
      if (m === "live") expect(inputs.fill.some((f) => f.artist === x.artist && f.dateSet === x.dateSet)).toBe(true);
    }
  });
});

describe("artist suggestions (/api/artists)", () => {
  beforeEach(() => { cacheClear(); resetSuggestBudget(); });
  const fake = (impl: QlooClient["search"]): QlooClient => ({ mode: "live", calls: [], search: vi.fn(impl), insights: vi.fn(), tags: vi.fn(), heatmap: vi.fn() } as unknown as QlooClient);

  it("normalizes the query and ignores short or odd input", () => {
    expect(normalizeQuery("  ja  pan ")).toBe("ja pan");
    expect(normalizeQuery("j")).toBeUndefined();
    expect(normalizeQuery("a\u0000b")).toBeUndefined();
    expect(normalizeQuery("x".repeat(81))).toBeUndefined();
  });
  it("mock mode suggests fixture acts only (no synthesized names)", async () => {
    expect(mockSuggestions("mari").map((s) => s.name)).toEqual(["Marigold Static"]);
    expect(mockSuggestions("salt")[0]).toMatchObject({ name: "Saltwater Hymnal (mock)", mock: true });
    expect(mockSuggestions("japanese")).toEqual([]);
    const res = await GET(new Request("http://localhost/api/artists?q=mar"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ mode: "mock", suggestions: [{ name: "Marigold Static" }] });
  });
  it("live mode calls Qloo /search for artists, maps name/detail/image, and caches", async () => {
    const q = fake(async () => [
      { name: "Japanese Breakfast", entity_id: "E1", properties: { short_description: "American indie pop band", image: { url: "https://img.example/jb.jpg" } } },
      { name: "Japanese Breakfast", entity_id: "E1" },
      { name: "Japan", entity_id: "E2", properties: { image: { url: "http://insecure/x.jpg" } } },
    ]);
    const r = await suggestArtists("japan", { qloo: q });
    expect(q.search).toHaveBeenCalledWith("japan", ["urn:entity:artist"], 6);
    expect(r.body.suggestions).toEqual([
      { id: "E1", name: "Japanese Breakfast", detail: "American indie pop band", image: "https://img.example/jb.jpg" },
      { id: "E2", name: "Japan", detail: undefined, image: undefined },
    ]);
    await suggestArtists("JAPAN ", { qloo: q });
    expect(q.search).toHaveBeenCalledTimes(1);
  });
  it("caps uncached live lookups per minute and reports provider failures without detail", async () => {
    const q = fake(async () => []);
    for (let i = 0; i < SUGGEST_LIVE_PER_MINUTE; i++) await suggestArtists(`q${i}x`, { qloo: q, now: 1000 });
    expect((await suggestArtists("one more", { qloo: q, now: 1000 })).status).toBe(429);
    expect((await suggestArtists("one more", { qloo: q, now: 70_000 })).status).toBe(200);
    const bad = fake(async () => { throw new Error("boom secret"); });
    const r = await suggestArtists("anything", { qloo: bad, now: 200_000 });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toMatch(/secret/);
  });
});
