import { beforeEach, describe, expect, it } from "vitest";
import { findActs, resetPromoterBudget, PROMOTER_LIVE_PER_MINUTE, PROMOTER_TAKE } from "@/lib/api/promoter";
import { GET } from "@/app/api/promoter/route";
import { cacheClear } from "@/lib/cache";
import { findMarket } from "@/lib/data/markets";
import { HttpQlooClient } from "@/lib/qloo/http-client";
import { MockQlooClient } from "@/lib/qloo/mock-client";
import { RateLimiter } from "@/lib/net/rate-limiter";
import { promoterScoreLine, scoreLine } from "@/lib/route/score-line";
import { fakeClock, scriptedFetch } from "./helpers";

// Synthetic envelopes only (field names per docs.qloo.com; values are placeholders, not Qloo output).
const ent = (i: number, extra: Record<string, unknown> = {}) => ({
  name: `Example Act ${i}`, entity_id: `00000000-0000-0000-0000-0000000000${String(i).padStart(2, "0")}`, subtype: "urn:entity:artist",
  popularity: 0.5, query: { affinity: 1 - i / 1000 }, properties: { image: { url: `https://example.invalid/${i}.jpg` } }, ...extra,
});
const insights = (n: number, locality?: { lat: number; lon: number }) => ({
  success: true,
  results: { entities: Array.from({ length: n }, (_, i) => ent(i + 1)) },
  ...(locality ? { query: { localities: { signal: { entity_id: "00000000-0000-0000-0000-00000000aaaa", name: "Example Locality", location: locality } } } } : {}),
});
const tagsDoc = { success: true, results: { tags: [{ id: "urn:tag:genre:music:example", name: "Example Genre", type: "urn:tag:genre:music" }] } };

function live(replies: Parameters<typeof scriptedFetch>[0]) {
  const f = scriptedFetch(replies), clock = fakeClock();
  const c = new HttpQlooClient("test-key", "https://hackathon.api.qloo.com", { retry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 50 } }, { fetch: f.fn, clock, limiter: new RateLimiter(0, clock), random: () => 1 });
  return { c, f };
}
const nash = findMarket("Nashville")!;
const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

beforeEach(() => { cacheClear(); resetPromoterBudget(); });

describe("promoter score line", () => {
  it("keeps the existing 'Qloo affinity: 0.XX' style and leaves the route score line unchanged", () => {
    expect(promoterScoreLine(0.9312)).toBe("Qloo affinity: 0.93 | Ranked by Qloo for this city");
    expect(scoreLine("with", 0.9312)).toBe("Qloo affinity: 0.93 | Ranked by affinity after filters");
  });
});

describe("findActs (live client, mocked fetch)", () => {
  it("asks /v2/insights for artists with the city as a location signal and returns the top 10 in Qloo's order", async () => {
    const { c, f } = live([{ body: insights(15, { lat: nash.lat + 0.05, lon: nash.lon }) }]);
    const r = await findActs("Nashville", null, { qloo: c });
    expect(r.status).toBe(200);
    // Acts, then the city's rooms and taste line (both soft: this script answers them with artist records).
    expect(f.calls).toHaveLength(3);
    expect(params(f.calls[0]!.url)).toEqual({ "filter.type": "urn:entity:artist", "signal.location.query": `Nashville, ${nash.state}`, take: "15" });
    const extra = f.calls.slice(1).map((x) => params(x.url));
    expect(extra).toContainEqual(expect.objectContaining({ "filter.type": "urn:entity:place", "filter.location": `POINT(${nash.lon.toFixed(4)} ${nash.lat.toFixed(4)})`, "filter.location.radius": "16000" }));
    expect(extra).toContainEqual({ "filter.type": "urn:tag", "signal.location.query": `Nashville, ${nash.state}`, "filter.tag.types": "urn:tag:genre:music", take: "10" });
    expect(r.body.rooms).toEqual([]);
    expect(r.body.taste).toEqual([]);
    expect(r.body.signal).toEqual({ kind: "locality", name: "Example Locality" });
    expect(r.body.acts).toHaveLength(PROMOTER_TAKE);
    expect(r.body.acts[0]).toMatchObject({ name: "Example Act 1", image: "https://example.invalid/1.jpg", scoreLine: "Qloo affinity: 1.00 | Ranked by Qloo for this city" });
    expect(r.body.acts.map((a) => a.name)).toEqual(Array.from({ length: 10 }, (_, i) => `Example Act ${i + 1}`));
  });
  it("resolves a genre with /v2/tags and applies it as filter.tags", async () => {
    const { c, f } = live([{ body: tagsDoc }, { body: insights(3, { lat: nash.lat, lon: nash.lon }) }]);
    const r = await findActs("Nashville", "example", { qloo: c });
    expect(params(f.calls[0]!.url)).toMatchObject({ "filter.query": "example", "filter.tag.types": "urn:tag:genre:music" });
    expect(params(f.calls[1]!.url)).toMatchObject({ "filter.tags": "urn:tag:genre:music:example" });
    expect(r.body.genre).toEqual({ query: "example", id: "urn:tag:genre:music:example", name: "Example Genre" });
  });
  it("falls back to a WKT point at the market centre when Qloo matches a far-away locality", async () => {
    const { c, f } = live([{ body: insights(2, { lat: 45, lon: -122 }) }, { body: insights(2) }]);
    const r = await findActs("Nashville", null, { qloo: c });
    expect(f.calls).toHaveLength(4);
    expect(params(f.calls[1]!.url)["signal.location"]).toBe(`POINT(${nash.lon.toFixed(4)} ${nash.lat.toFixed(4)})`);
    expect(f.calls.slice(2).map((x) => params(x.url)["signal.location"])).toContain(`POINT(${nash.lon.toFixed(4)} ${nash.lat.toFixed(4)})`);
    expect(r.body.signal).toMatchObject({ kind: "point" });
  });
  it("drops duplicate ids and insecure images; caches per city+genre", async () => {
    const doc = insights(2, { lat: nash.lat, lon: nash.lon });
    doc.results.entities.push(ent(1), ent(3, { properties: { image: { url: "http://insecure.invalid/x.jpg" } } }));
    const { c, f } = live([{ body: doc }]);
    const r = await findActs("Nashville", null, { qloo: c });
    expect(r.body.acts.map((a) => a.name)).toEqual(["Example Act 1", "Example Act 2", "Example Act 3"]);
    expect(r.body.acts[2]!.image).toBeUndefined();
    await findActs("nashville", "", { qloo: c });
    expect(f.calls).toHaveLength(3);
  });
  it("validates input, rate limits uncached lookups and hides provider detail", async () => {
    const { c } = live([{ status: 500, body: "boom secret" }]);
    expect((await findActs("Atlantis", null, { qloo: c })).status).toBe(400);
    expect((await findActs("Nashville", "x", { qloo: c })).status).toBe(400);
    const bad = await findActs("Nashville", null, { qloo: c, now: 1000 });
    expect(bad.status).toBe(502);
    expect(JSON.stringify(bad.body)).not.toMatch(/secret|test-key/);
    for (let i = 1; i < PROMOTER_LIVE_PER_MINUTE; i++) await findActs("Nashville", null, { qloo: c, now: 1000 });
    expect((await findActs("Nashville", null, { qloo: c, now: 1000 })).status).toBe(429);
  });
  it("reports a genre Qloo has no tag for, without guessing", async () => {
    const { c, f } = live([{ body: { success: true, results: { tags: [] } } }]);
    const r = await findActs("Nashville", "zzz", { qloo: c });
    expect(r.body.error).toMatch(/no music genre tag/);
    expect(r.body.acts).toEqual([]);
    expect(f.calls).toHaveLength(1);
  });
});

describe("findActs (mock mode)", () => {
  it("returns fictional fixture acts, filtered by a mock genre", async () => {
    const q = new MockQlooClient([0, 0]);
    const r = await findActs("Seattle", null, { qloo: q });
    expect(r.body.mode).toBe("mock");
    expect(r.body.acts.length).toBeGreaterThan(5);
    expect(r.body.acts.every((a) => a.mock && /\(mock\)/.test(a.name))).toBe(true);
    const g = await findActs("Seattle", "shoegaze", { qloo: q });
    expect(g.body.genre?.id).toBe("urn:tag:genre:music:shoegaze");
    expect(g.body.acts.map((a) => a.name).sort()).toEqual(["Saltwater Hymnal (mock)", "Sun Hollow (mock)"]);
  });
  it("GET /api/promoter answers JSON", async () => {
    const res = await GET(new Request("http://localhost/api/promoter?city=Austin"));
    expect(res.status).toBe(200);
    expect((await res.json()).acts.length).toBeGreaterThan(0);
  });
});
