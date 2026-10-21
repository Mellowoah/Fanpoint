import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES, PlanBody, readPlanRequest } from "@/lib/api/plan-request";
import { POST } from "@/app/api/plan/route";
import { getConfig, publicModes } from "@/lib/config";
import { createQlooClient } from "@/lib/qloo";
import { createLlmClient } from "@/lib/llm";
import { parseEventLine } from "@/lib/client/stream";

const fill = (o: Record<string, unknown> = {}) => ({
  task: "fill", artist: "Marigold Static", maxDriveMi: 350,
  anchors: [{ city: "New York", date: "2026-11-13" }, { city: "Durham", date: "2026-11-21" }], ...o,
});
const req = (body: unknown, headers: Record<string, string> = { "content-type": "application/json" }) =>
  new Request("http://localhost/api/plan", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });
const issues = (b: unknown) => { const r = PlanBody.safeParse(b); return r.success ? [] : r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`); };

describe("PlanBody validation", () => {
  it("accepts the demo request and applies defaults", () => {
    const r = PlanBody.parse(fill());
    expect(r).toMatchObject({ task: "fill", minAffinity: 0.94, mode: "qloo" });
    expect(PlanBody.parse({ task: "cohead", artist: " X ", partner: "" })).toEqual({ task: "cohead", artist: "X", partner: undefined, mode: "qloo" });
  });
  it.each([
    ["unknown task", { task: "nope", artist: "x" }],
    ["unknown key (strict)", fill({ extra: 1 })],
    ["empty artist", fill({ artist: "   " })],
    ["control chars", fill({ artist: "a\u0000b" })],
    ["artist too long", fill({ artist: "x".repeat(121) })],
    ["one anchor", fill({ anchors: [{ city: "New York", date: "2026-11-13" }] })],
    ["five anchors", fill({ anchors: ["New York", "Durham", "Atlanta", "Richmond", "Boston"].map((c, i) => ({ city: c, date: `2026-11-1${i}` })) })],
    ["unknown city", fill({ anchors: [{ city: "Atlantis", date: "2026-11-13" }, { city: "Durham", date: "2026-11-21" }] })],
    ["impossible date", fill({ anchors: [{ city: "New York", date: "2026-02-30" }, { city: "Durham", date: "2026-03-05" }] })],
    ["US date format", fill({ anchors: [{ city: "New York", date: "11/13/2026" }, { city: "Durham", date: "2026-11-21" }] })],
    ["duplicate dates", fill({ anchors: [{ city: "New York", date: "2026-11-13" }, { city: "Durham", date: "2026-11-13" }] })],
    ["duplicate cities", fill({ anchors: [{ city: "Durham", date: "2026-11-13" }, { city: "durham", date: "2026-11-21" }] })],
    ["tour too long", fill({ anchors: [{ city: "New York", date: "2026-11-01" }, { city: "Durham", date: "2026-12-31" }] })],
    ["drive too short", fill({ maxDriveMi: 50 })],
    ["drive hours over the federal 10 h ceiling", fill({ rules: { maxDriveHours: 11 } })],
    ["zero shows in a row", fill({ rules: { maxConsecutiveShows: 0 } })],
    ["six night weights", fill({ rules: { dowWeights: [1, 1, 1, 1, 1, 1] } })],
    ["a rule that isn't adjustable", fill({ rules: { spacingMi: 5 } })],
    ["drive not integer", fill({ maxDriveMi: 350.5 })],
    ["affinity > 1", fill({ minAffinity: 2 })],
    ["label too long", fill({ anchors: [{ city: "New York", date: "2026-11-13", label: "x".repeat(41) }, { city: "Durham", date: "2026-11-21" }] })],
    ["unknown anchor key", fill({ anchors: [{ city: "New York", date: "2026-11-13", lat: 1 }, { city: "Durham", date: "2026-11-21" }] })],
    ["cohead plain mode", { task: "cohead", artist: "x", mode: "plain" }],
    ["string number", fill({ maxDriveMi: "350" })],
  ])("rejects %s", (_, body) => expect(issues(body).length).toBeGreaterThan(0));
  it("accepts overrides for the adjustable touring assumptions", () => {
    const r = PlanBody.parse(fill({ rules: { maxDriveHours: 6, maxConsecutiveShows: 4, radiusMi: 100, nightFloor: 0.3, dowWeights: [0.5, 0.5, 0.5, 0.5, 1, 1, 1] } }));
    expect(r).toMatchObject({ rules: { maxDriveHours: 6, maxConsecutiveShows: 4 } });
  });
  it("explains problems with paths", () => {
    expect(issues(fill({ anchors: [{ city: "Atlantis", date: "2026-11-13" }, { city: "Durham", date: "2026-11-21" }] }))).toEqual(["anchors.0.city: pick a city from the touring-city list"]);
  });
});

describe("readPlanRequest", () => {
  it("requires JSON content-type", async () => {
    expect(await readPlanRequest(req(fill(), { "content-type": "text/plain" }))).toMatchObject({ ok: false, status: 415 });
  });
  it("rejects oversized bodies (declared or actual)", async () => {
    expect(await readPlanRequest(req({ ...fill(), pad: "x".repeat(MAX_BODY_BYTES) }))).toMatchObject({ ok: false, status: 413 });
    expect(await readPlanRequest(req(fill(), { "content-type": "application/json", "content-length": String(MAX_BODY_BYTES + 1) }))).toMatchObject({ ok: false, status: 413 });
  });
  it("rejects invalid JSON", async () => {
    expect(await readPlanRequest(req("{nope"))).toMatchObject({ ok: false, status: 400, payload: { error: { code: "invalid_json" } } });
  });
  it("returns readable validation errors", async () => {
    const r = await readPlanRequest(req(fill({ maxDriveMi: 9999 })));
    expect(r).toMatchObject({ ok: false, status: 400, payload: { error: { code: "invalid_request", issues: [{ path: "maxDriveMi" }] } } });
  });
  it("accepts content-type with charset", async () => {
    expect(await readPlanRequest(req(fill(), { "content-type": "application/json; charset=utf-8" }))).toMatchObject({ ok: true });
  });
});

describe("POST /api/plan", () => {
  const read = async (res: Response) => (await res.text()).trim().split("\n").map((l) => parseEventLine(l));
  it("400s with JSON on bad input (before streaming)", async () => {
    const res = await POST(req({ task: "fill" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });
  it("streams NDJSON events ending in a result (plain baseline, mock)", async () => {
    const res = await POST(req(fill({ mode: "plain" })));
    expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    const ev = await read(res);
    expect(ev.every(Boolean)).toBe(true);
    expect(ev.at(-1)?.type).toBe("result");
  });
  it("streams a full Qloo-mode fill run", async () => {
    const ev = await read(await POST(req(fill())));
    expect(ev.filter((e) => e?.type === "tool").length).toBeGreaterThan(3);
    expect(ev.at(-1)?.type).toBe("result");
  }, 20_000);
});

describe("config and factories (keys stay server-side)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("defaults to mock with no keys", () => {
    vi.stubEnv("QLOO_API_KEY", ""); vi.stubEnv("LLM_API_KEY", ""); vi.stubEnv("ROUTED_FORCE_MOCK", "");
    expect(publicModes()).toEqual({ qloo: "mock", llm: "mock" });
    expect(createQlooClient().mode).toBe("mock");
    expect(createLlmClient().mode).toBe("mock");
  });
  it("goes live with keys, trims values, and the hackathon host is the default", () => {
    vi.stubEnv("QLOO_API_KEY", "  qk  "); vi.stubEnv("LLM_API_KEY", "lk"); vi.stubEnv("ROUTED_FORCE_MOCK", "");
    const c = getConfig();
    expect(c.qloo).toEqual({ mode: "live", apiKey: "qk", baseUrl: "https://hackathon.api.qloo.com" });
    expect(createQlooClient().mode).toBe("live");
    expect(createLlmClient().mode).toBe("live");
  });
  it("ROUTED_FORCE_MOCK=1 wins over keys", () => {
    vi.stubEnv("QLOO_API_KEY", "qk"); vi.stubEnv("LLM_API_KEY", "lk"); vi.stubEnv("ROUTED_FORCE_MOCK", "1");
    expect(publicModes()).toEqual({ qloo: "mock", llm: "mock" });
  });
  it("publicModes never includes key material", () => {
    vi.stubEnv("QLOO_API_KEY", "super-secret-qloo"); vi.stubEnv("LLM_API_KEY", "super-secret-llm"); vi.stubEnv("ROUTED_FORCE_MOCK", "");
    expect(JSON.stringify(publicModes())).not.toMatch(/super-secret/);
  });
});
