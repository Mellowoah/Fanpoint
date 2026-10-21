/** Named venues, fan neighborhoods, co-headliner taste/skews/joint room, promoter rooms + taste. Synthetic data only. */
import { beforeEach, describe, expect, it } from "vitest";
import { categoryOf, hoodForVenue, isShowRoom, safeUrl, statedCapacity, tierOf, type FanHood } from "@/lib/qloo/venues";
import { isMusicAct, sharedTaste, skewSummary, tasteLine, type TagScore } from "@/lib/qloo/taste";
import { parseDemographics, parseLocalityHeat, parseScoredTags, wktCentre, countResults } from "@/lib/qloo/schemas";
import { normalize, placeInfo } from "@/lib/qloo/normalize";
import { HttpQlooClient, LOCALITY_HEAT_MAX_BYTES } from "@/lib/qloo/http-client";
import { MockQlooClient } from "@/lib/qloo/mock-client";
import { RateLimiter } from "@/lib/net/rate-limiter";
import { ProviderError } from "@/lib/net/errors";
import { Registry, Tools } from "@/lib/agent/tools";
import { roomNote } from "@/lib/agent/run";
import { actsForRoom, findActs, resetPromoterBudget, PROMOTER_LIVE_PER_MINUTE } from "@/lib/api/promoter";
import { GET as roomGET } from "@/app/api/promoter/room/route";
import { cacheClear } from "@/lib/cache";
import { findCity } from "@/lib/route/cities";
import { findMarket } from "@/lib/data/markets";
import type { QlooParams, QlooRawEntity } from "@/lib/qloo/types";
import { fakeClock, scriptedFetch } from "./helpers";

beforeEach(() => { cacheClear(); resetPromoterBudget(); });

function live(replies: Parameters<typeof scriptedFetch>[0]) {
  const f = scriptedFetch(replies), clock = fakeClock();
  const c = new HttpQlooClient("test-key", "https://hackathon.api.qloo.com", { retry: { retries: 0, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 50, maxBodyBytes: 1024 } }, { fetch: f.fn, clock, limiter: new RateLimiter(0, clock), random: () => 1 });
  return { c, f };
}
const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

describe("venue helpers", () => {
  it("maps a Qloo category to a size tier; off-list categories are not show rooms", () => {
    expect(categoryOf("urn:tag:genre:place:restaurant:live_music_bar")).toBe("live_music_bar");
    expect(categoryOf(undefined)).toBeUndefined();
    expect(tierOf("night_club")).toBe("club");
    expect(tierOf("live_music_venue")).toBe("venue");
    expect(tierOf("concert_hall")).toBe("theatre");
    expect(tierOf("amphitheater")).toBe("arena");
    expect(isShowRoom("coffee_shop")).toBe(false);
    expect(isShowRoom(undefined)).toBe(false);
  });
  it("reads a capacity only when the text states one, quoting whole words", () => {
    expect(statedCapacity(["An example hall with a 1,016-seat auditorium and a bar."])).toEqual({ capacity: 1016, quote: "An example hall with a 1,016-seat auditorium and a bar." });
    expect(statedCapacity([undefined, "Standing room with a capacity of up to 750 guests."])?.capacity).toBe(750);
    expect(statedCapacity(["A 900-capacity room."])?.capacity).toBe(900);
    const long = statedCapacity(["Lorem ipsum dolor sit amet consectetur adipiscing elit, with a 2,500 person floor, then many more words after it here."])!;
    expect(long.quote).toMatch(/^….*2,500 person.*…$/);
    expect(long.quote.startsWith("…consectetur ")).toBe(true); // widened to a whole word
    expect(statedCapacity(["Open since 1999.", "Seats 5 people.", "A 500000-seat stadium."])).toBeUndefined();
    expect(statedCapacity([])).toBeUndefined();
  });
  it("only passes http(s) links", () => {
    expect(safeUrl("https://example.org/x")).toBe("https://example.org/x");
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl(undefined)).toBeUndefined();
  });
  it("matches a venue to a fan neighborhood by name first, then by distance", () => {
    const hoods: FanHood[] = [{ id: "a", name: "Old Mill", affinity: 0.9, lat: 35, lon: -78.9 }, { id: "b", name: "Riverside", affinity: 0.8, lat: 35.1, lon: -78.9 }, { id: "c", name: "No Point", affinity: 0.7 }];
    expect(hoodForVenue({ place: { neighborhood: "riverside" } }, hoods)).toMatchObject({ how: "named", hood: { id: "b" } });
    expect(hoodForVenue({ lat: 35.005, lon: -78.9 }, hoods)).toMatchObject({ how: "near", hood: { id: "a" }, mi: 0.3 });
    expect(hoodForVenue({ lat: 36, lon: -78.9 }, hoods)).toBeUndefined();
    expect(hoodForVenue({ place: { neighborhood: "Elsewhere" } }, hoods)).toBeUndefined();
  });
});

describe("taste helpers", () => {
  const t = (name: string, score: number, subtype = "urn:tag:genre:music"): TagScore => ({ id: `urn:tag:x:${name}`, name, subtype, score });
  it("de-noises shared taste: taste subtypes only, tie blocks dropped, one per name", () => {
    const tags = [t("Folk", 0.9), t("folk ", 0.8), t("Intimate", 0.85, "urn:tag:style:qloo"), t("North America", 0.95, "urn:tag:region:qloo"), t("Guitar", 0.9, "urn:tag:instrument:qloo"),
      ...["Dub", "Disco", "Funk", "Krautrock"].map((n) => t(n, 0.5)), t("Untyped", 0.99, "")];
    expect(sharedTaste(tags).map((x) => x.name)).toEqual(["Folk", "Intimate"]);
    expect(sharedTaste([t("A", 0.5), t("B", 0.5), t("C", 0.5)], 2).map((x) => x.name)).toEqual(["A", "B"]);
  });
  it("cleans a city taste line and summarizes relative skews", () => {
    expect(tasteLine([t(" Indie Rock ", 0.9), t("indie rock", 0.8), t("x", 0.7), t("Folk", 0.6)])).toEqual(["Indie Rock", "Folk"]);
    expect(tasteLine([t("Alt- country", 0.9), t("americana", 0.8), t("North Carolina", 0.7), t("Folk/Rock", 0.6)])).toEqual(["Alt-country", "Americana", "Folk/Rock"]);
    expect(skewSummary({ entityId: "a", age: { "25_to_29": 0.3, "30_to_34": 0.4, "55_and_older": 0.2, odd: 0.1 }, gender: { female: 0.2, male: -0.2 } })).toEqual({ ages: ["30–34", "25–29"], gender: "female-leaning" });
    expect(skewSummary({ entityId: "a", age: { odd: 0.5 }, gender: {} })).toEqual({ ages: ["odd"], gender: undefined });
  });
  it("keeps only acts with a music genre tag", () => {
    expect(isMusicAct([{ type: "urn:tag:genre:music" }])).toBe(true);
    expect(isMusicAct([{ subtype: "urn:tag:genre:music:indie" }])).toBe(true);
    expect(isMusicAct([{ type: "urn:tag:genre:tv" }, {}])).toBe(false);
    expect(isMusicAct(undefined)).toBe(false);
  });
});

describe("parsers for the new Qloo shapes", () => {
  it("centres POINT and small POLYGON / MULTIPOLYGON boundaries", () => {
    expect(wktCentre("POINT (-75.15 39.93)")).toEqual({ lon: -75.15, lat: 39.93 });
    expect(wktCentre("POLYGON((0 0, 2 0, 2 4, 0 4, 0 0))")).toEqual({ lat: 2, lon: 1 });
    expect(wktCentre("MULTIPOLYGON(((0 0, 1 0, 1 1, 0 0)),((3 3, 4 3, 4 4, 3 3)))")).toEqual({ lat: 2, lon: 2 });
    expect(wktCentre("LINESTRING(0 0, 1 1)")).toBeUndefined();
    expect(wktCentre("POLYGON EMPTY")).toBeUndefined();
    expect(wktCentre(`POLYGON((${"0 0, ".repeat(50_000)}0 0))`)).toBeUndefined();
  });
  it("reduces a locality heatmap to named neighborhoods with centre points (no geometry kept)", () => {
    const doc = { results: { entities: [
      { name: "Example Hood", entity_id: "h1", popularity: 0.5, disambiguation: "Example Hood, Example City, Example County, EX, United States", query: { affinity: 0.9 }, boundary: "POINT (-75 40)" },
      { name: "Example City", entity_id: "c1", disambiguation: "Example City, Example County, EX, United States", query: { affinity: 0.7 }, boundary: "POLYGON((0 0, 1 0, 1 1, 0 0))" },
      { name: "No Score", entity_id: "x", query: {} },
    ] } };
    const p = parseLocalityHeat(doc);
    expect(p.dropped).toBe(1);
    expect(p.items).toEqual([
      { id: "h1", name: "Example Hood", affinity: 0.9, popularity: 0.5, level: "neighborhood", city: "Example City", lat: 40, lon: -75 },
      { id: "c1", name: "Example City", affinity: 0.7, popularity: undefined, level: "area", city: undefined, lat: undefined, lon: undefined },
    ]);
    expect(JSON.stringify(p.items)).not.toMatch(/POINT|POLYGON/);
  });
  it("parses demographics and scored tags; unscored tags are dropped", () => {
    const d = { results: { demographics: [{ entity_id: "a", query: { age: { "25_to_29": 0.2 }, gender: { male: -0.1, female: 0.1 } } }, { entity_id: "b", query: {} }] } };
    expect(parseDemographics(d).items).toEqual([{ entityId: "a", age: { "25_to_29": 0.2 }, gender: { male: -0.1, female: 0.1 } }, { entityId: "b", age: {}, gender: {} }]);
    expect(countResults(d)).toBe(2);
    const tags = parseScoredTags({ results: { tags: [{ tag_id: "t1", name: "Folk", subtype: "urn:tag:genre:music", query: { score: 0.8 } }, { id: "t2", name: "Rock", type: "urn:tag:genre:music", query: { affinity: 0.7 } }, { id: "t3", name: "Plain", type: "urn:tag" , query: { affinity: 0.6 } }, { id: "t4", name: "None" }] } });
    expect(tags.items).toEqual([{ id: "t1", name: "Folk", subtype: "urn:tag:genre:music", score: 0.8 }, { id: "t2", name: "Rock", subtype: "urn:tag:genre:music", score: 0.7 }, { id: "t3", name: "Plain", subtype: undefined, score: 0.6 }]);
    expect(tags.dropped).toBe(1);
  });
  it("normalizes place facts; non-places carry none", () => {
    const raw: QlooRawEntity = { name: "Example Room", entity_id: "p1", subtype: "urn:entity:place", properties: { geocode: { name: "Example Hood", city: "Example City" }, address: " 1 Example St ", website: "ftp://bad", primary_genre: { id: "urn:tag:genre:place:concert_hall", name: "Concert Hall" }, description: "A 1,200-seat hall." } };
    const e = normalize(raw);
    expect(e.city).toBe("Example City");
    expect(e.place).toEqual({ address: "1 Example St", website: undefined, phone: undefined, neighborhood: undefined, category: "concert_hall", categoryName: "Concert Hall", capacity: 1200, capacityQuote: "A 1,200-seat hall." });
    expect(normalize({ ...raw, subtype: "urn:entity:artist" }).place).toBeUndefined();
    expect(placeInfo({ name: "x", entity_id: "y" })).toBeUndefined();
    expect(placeInfo({ name: "x", entity_id: "y", properties: {} })).toBeUndefined();
  });
});

describe("HttpQlooClient: new endpoints", () => {
  it("builds locality heatmap, demographics, taste and compare requests", async () => {
    const big = { results: { entities: [{ name: "Example Hood", entity_id: "h1", disambiguation: "Example Hood, Example City, Example County, EX, US", query: { affinity: 0.9 }, boundary: `POINT (-75 40)${" ".repeat(4096)}` }] } };
    const { c, f } = live([{ body: big }, { body: { results: { demographics: [] } } }, { body: { results: { tags: [] } } }, { body: { results: { tags: [] } } }, { body: { results: { entities: [] }, pad: " ".repeat(4096) } }]);
    // The locality heatmap may exceed the default body cap (1 KB here); other calls may not.
    expect(LOCALITY_HEAT_MAX_BYTES).toBeGreaterThan(16 * 1024 * 1024);
    expect(await c.localityHeat({ "filter.location": "POINT(-75 40)" })).toHaveLength(1);
    await c.demographics(["a", "b"]);
    await c.tagInsights({ "signal.location.query": "Example City" });
    await c.compare("a", "b");
    const p = f.calls.map((x) => ({ path: new URL(x.url).pathname, ...params(x.url) }));
    expect(p[0]).toMatchObject({ path: "/v2/insights", "filter.type": "urn:heatmap", "output.heatmap.boundary": "urn:entity:locality" });
    expect(p[1]).toEqual({ path: "/v2/insights", "filter.type": "urn:demographics", "signal.interests.entities": "a,b" });
    expect(p[2]).toMatchObject({ "filter.type": "urn:tag", "signal.location.query": "Example City" });
    expect(p[3]).toEqual({ path: "/v2/analysis/compare", "a.signal.interests.entities": "a", "b.signal.interests.entities": "b", take: "30" });
    await expect(c.insights({ x: 1 })).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("mock client: synthetic place, locality, taste data", () => {
  it("answers every new method without keys, with fictional names", async () => {
    const q = new MockQlooClient([0, 0]);
    const durham = findCity("Durham")!;
    const rooms = await q.insights({ "filter.type": "urn:entity:place", "filter.location": `POINT(${durham.lon} ${durham.lat})`, take: 15 });
    expect(rooms.every((r) => /\(mock\)/.test(r.name) && r.properties?.website?.startsWith("https://example.org/"))).toBe(true);
    expect(rooms.map((r) => normalize(r, "urn:entity:place")).filter((e) => isShowRoom(e.place?.category)).length).toBeLessThan(rooms.length);
    const hoods = await q.localityHeat({ "filter.location": `POINT(${durham.lon} ${durham.lat})` });
    expect(hoods.filter((h) => h.level === "neighborhood").every((h) => h.city === "Durham" && h.lat !== undefined)).toBe(true);
    expect(await q.localityHeat({})).toEqual([]);
    expect((await q.demographics(["a", "b"])).map((d) => d.entityId)).toEqual(["a", "b"]);
    expect((await q.tagInsights({ "signal.location.query": "Durham, NC", take: 3 }))).toHaveLength(3);
    expect((await q.tagInsights({ "signal.interests.entities": "mock-artist-x" })).length).toBeGreaterThan(0);
    const cmp = await q.compare("mock-artist-velvet-orchard-mock", "mock-artist-fernhill-static-mock");
    expect(sharedTaste(cmp).map((t) => t.name)).toEqual(["Dream Pop", "Intimate", "Introspective"]);
  });
});

/** Mock Qloo with injected answers / failures for the new calls. */
class Scripted extends MockQlooClient {
  constructor(private o: { places?: (p: QlooParams) => QlooRawEntity[]; heat?: () => never; demo?: () => never; compare?: () => never } = {}) { super([0, 0]); }
  override async insights(p: QlooParams) { if (p["filter.type"] === "urn:entity:place" && this.o.places) return this.o.places(p); return super.insights(p); }
  override async localityHeat(p: QlooParams) { if (this.o.heat) this.o.heat(); return super.localityHeat(p); }
  override async demographics(ids: string[]) { if (this.o.demo) this.o.demo(); return super.demographics(ids); }
  override async compare(a: string, b: string) { if (this.o.compare) this.o.compare(); return super.compare(a, b); }
}
const fail = () => { throw new ProviderError("qloo", "upstream", "injected"); };
const place = (name: string, lat: number, lon: number, category: string, affinity: number, extra: Record<string, unknown> = {}): QlooRawEntity => ({
  name, entity_id: `id-${name.replace(/\W+/g, "-")}`, subtype: "urn:entity:place", location: { lat, lon }, query: { affinity },
  properties: { geocode: { city: "Example City" }, primary_genre: { id: `urn:tag:genre:place:${category}` }, ...extra },
});

describe("city intel: rooms and fan neighborhoods", () => {
  async function intel(q: MockQlooClient, city = "Durham") {
    const reg = new Registry();
    const t = new Tools(q, reg);
    await t.call("resolve_artist", { name: "Marigold Static" });
    const r = await t.call("get_city_intel", { artist_id: reg.artist!.id, city });
    return { reg, r, t };
  }
  it("asks for rooms with a market-centre POINT + radius, keeps show rooms in range, best fit first", async () => {
    const c = findCity("Durham")!;
    let seen: QlooParams | undefined;
    const q = new Scripted({ places: (p) => { seen = p; return [
      place("Cafe Example", c.lat, c.lon, "restaurant:coffee_shop", 0.99),
      place("Far Hall", c.lat + 1, c.lon, "concert_hall", 0.95),
      place("Low Club", c.lat, c.lon, "night_club", 0.7),
      place("Top Venue", c.lat, c.lon, "live_music_venue", 0.9),
    ]; } });
    const { reg } = await intel(q);
    expect(seen).toMatchObject({ "filter.location": `POINT(${c.lon.toFixed(4)} ${c.lat.toFixed(4)})`, "filter.location.radius": 16000, take: 15 });
    expect(String(seen!["filter.tags"])).toContain("urn:tag:category:place:live_music_venue");
    expect(seen!["filter.location.query"]).toBeUndefined();
    expect(reg.intel.get("durham")!.venues.map((v) => v.name)).toEqual(["Top Venue", "Low Club"]);
    expect(reg.warnings.join(" ")).toMatch(/1 Qloo room\(s\) more than 25 mi/);
    expect(reg.intel.get("durham")!.hoods.length).toBeGreaterThan(0);
  });
  it("a failed neighborhood lookup costs only the neighborhoods", async () => {
    const { reg, r } = await intel(new Scripted({ heat: fail }));
    expect(reg.intel.get("durham")!.hoods).toEqual([]);
    expect(reg.intel.get("durham")!.venues.length).toBeGreaterThan(0);
    expect(r.summary).not.toMatch(/fans in/);
    expect(reg.warnings.join(" ")).toMatch(/fan neighborhoods/);
  });
});

describe("room note", () => {
  const stop = { city: "Camden", lat: 39.944, lon: -75.119 };
  const hoods: FanHood[] = [{ id: "q", name: "Example Village", affinity: 0.88, lat: 39.937, lon: -75.15 }];
  it("names the room's own city across a line, and the fan neighborhood it sits in", () => {
    const n = roomNote({ id: "v", name: "Example Hall", kind: "place", tags: [], mock: false, affinity: 0.81, lat: 39.94, lon: -75.15, city: "Philadelphia", place: { neighborhood: "Example Village" } }, hoods, stop);
    expect(n.hood).toEqual({ name: "Example Village", how: "named", mi: undefined });
    expect(n.why).toBe("Top Qloo room for this artist's audience near Camden (fit 81). It is in Philadelphia, 1.7 mi from Camden (same market). It is in Example Village, a neighborhood where these fans cluster (heat 88).");
  });
  it("falls back to a nearby neighborhood, or to no neighborhood and no score", () => {
    expect(roomNote({ id: "v", name: "x", kind: "place", tags: [], mock: false, affinity: 0.5, lat: 39.938, lon: -75.15, city: "Camden" }, hoods, stop).why).toMatch(/It is 0.1 mi from Example Village/);
    const bare = roomNote({ id: "v", name: "x", kind: "place", tags: [], mock: false }, hoods, stop);
    expect(bare).toEqual({ mi: undefined, hood: undefined, why: "Top Qloo room near Camden." });
  });
});

describe("co-headliner extras", () => {
  async function cohead(q: MockQlooClient) {
    const reg = new Registry();
    const t = new Tools(q, reg);
    await t.call("resolve_artist", { name: "Marigold Static" });
    await t.call("find_peer_acts", { artist_id: reg.artist!.id });
    await t.call("compare_fan_geography", { artist_id: reg.artist!.id });
    const ids = reg.matches.slice(0, 2).map((m) => m.entity.id);
    return { reg, ids, r: await t.coheadExtras(reg.artist!.id, [...ids, reg.artist!.id, "unknown-peer"]) };
  }
  it("fetches skews in one call, shared taste and a joint room in the best shared city", async () => {
    const q = new MockQlooClient([0, 0]);
    const { reg, ids, r } = await cohead(q);
    expect(q.calls.filter((c) => c.params["filter.type"] === "urn:demographics")).toHaveLength(1);
    expect(Object.keys(r.extras.skews)).toContain(reg.artist!.id);
    const p = r.extras.byPeer[ids[0]!]!;
    expect(p.shared.length).toBeGreaterThan(0);
    expect(p.joint?.venue?.kind).toBe("place");
    const you = reg.geo.get(reg.artist!.id)!, them = reg.geo.get(ids[0]!)!;
    const best = Math.max(...[...you.values()].filter((c) => them.has(c.name)).map((c) => Math.min(c.affinity, them.get(c.name)!.affinity)));
    expect(Math.min(p.joint!.you, p.joint!.them)).toBe(best);
    expect(q.calls.find((c) => c.params["filter.type"] === "urn:entity:place")!.params["signal.interests.entities"]).toBe(`${reg.artist!.id},${ids[0]}`);
    expect(r.extras.byPeer["unknown-peer"]).toEqual({ shared: expect.any(Array), joint: undefined });
    expect(r.summary).toMatch(/joint rooms for 3 peers/);
  });
  it("degrades softly when demographics, compare or the room lookup fail", async () => {
    const { reg, ids, r } = await cohead(new Scripted({ demo: fail, compare: fail, places: fail }));
    expect(r.extras.skews).toEqual({});
    expect(r.extras.byPeer[ids[0]!]!.shared).toEqual([]);
    expect(r.extras.byPeer[ids[0]!]!.joint?.venue).toBeUndefined();
    expect(reg.warnings.join(" ")).toMatch(/Audience demographics.*|Shared taste|Joint room/);
  });
});

describe("promoter: rooms, taste and who fits this room", () => {
  it("mock mode: city lookup lists show rooms and a taste line; a room ranks music acts", async () => {
    const q = new MockQlooClient([0, 0]);
    const r = await findActs("Durham", null, { qloo: q });
    expect(r.body.rooms!.length).toBeGreaterThan(0);
    expect(r.body.rooms!.every((x) => x.tier)).toBe(true);
    expect(r.body.taste!.length).toBeGreaterThan(0);
    const fit = await actsForRoom("Durham", r.body.rooms![0]!.id, { qloo: q });
    expect(fit.status).toBe(200);
    expect(fit.body.room?.id).toBe(r.body.rooms![0]!.id);
    expect(fit.body.acts.length).toBeGreaterThan(0);
    const n = q.calls.length;
    await actsForRoom("durham", r.body.rooms![0]!.id, { qloo: q });
    expect(q.calls.length).toBe(n); // cached
  });
  it("validates the city and the room, drops non-music acts, rate limits and hides provider detail", async () => {
    const m = findMarket("Durham")!;
    const room = { name: "Example Room", entity_id: "room-1", subtype: "urn:entity:place", properties: { primary_genre: { id: "urn:tag:genre:place:live_music_venue" } } };
    const act = (i: number, music: boolean) => ({ name: `Example Act ${i}`, entity_id: `act-${i}`, query: { affinity: 0.9 }, tags: music ? [{ name: "Example Genre", type: "urn:tag:genre:music" }] : [{ name: "Reality", type: "urn:tag:genre:tv" }] });
    const { c, f } = live([{ body: { results: { entities: [room] } } }, { body: { results: { entities: [act(1, true), act(2, false), act(3, true)] } } }]);
    expect((await actsForRoom("Atlantis", "room-1", { qloo: c })).status).toBe(400);
    expect((await actsForRoom("Durham", "../etc", { qloo: c })).status).toBe(400);
    expect((await actsForRoom("Durham", null, { qloo: c })).status).toBe(400);
    const ok = await actsForRoom("Durham", "room-1", { qloo: c });
    expect(ok.body.acts.map((a) => a.name)).toEqual(["Example Act 1", "Example Act 3"]);
    expect(ok.body.dropped).toBe(1);
    expect(ok.body.acts[0]!.scoreLine).toBe("Qloo affinity: 0.90 | Ranked by Qloo for this room");
    expect(params(f.calls[1]!.url)).toEqual({ "filter.type": "urn:entity:artist", "signal.interests.entities": "room-1", "signal.location": `POINT(${m.lon.toFixed(4)} ${m.lat.toFixed(4)})`, take: "15" });
    expect((await actsForRoom("Durham", "room-2", { qloo: c })).body.error).toMatch(/Pick a room/);
    for (let i = 0; i < PROMOTER_LIVE_PER_MINUTE; i++) await actsForRoom("Durham", `room-x${i}`, { qloo: c, now: 5 });
    expect((await actsForRoom("Durham", "room-y", { qloo: c, now: 5 })).status).toBe(429);
    cacheClear(); resetPromoterBudget();
    const bad = live([{ status: 500, body: "boom secret" }]);
    const r = await actsForRoom("Durham", "room-1", { qloo: bad.c });
    expect(r.status).toBe(502);
    expect(JSON.stringify(r.body)).not.toMatch(/secret/);
  });
  it("GET /api/promoter/room answers JSON", async () => {
    const res = await roomGET(new Request("http://localhost/api/promoter/room?city=Durham&venue=nope!"));
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
