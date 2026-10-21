import { beforeEach, describe, expect, it } from "vitest";
import heatmapDoc from "./fixtures/qloo-shapes/heatmap.json";
import artistDoc from "./fixtures/qloo-shapes/insights-artist.json";
import searchDoc from "./fixtures/qloo-shapes/search.json";
import tagsDoc from "./fixtures/qloo-shapes/tags.json";
import { HttpQlooClient } from "@/lib/qloo/http-client";
import { OpenAICompatibleClient } from "@/lib/llm/openai-compatible";
import { parseChatCompletion, parseJsonContent, parseToolArgs } from "@/lib/llm/schemas";
import { ProviderError } from "@/lib/net/errors";
import { RateLimiter } from "@/lib/net/rate-limiter";
import { cacheClear } from "@/lib/cache";
import { fakeClock, scriptedFetch } from "./helpers";

const RETRY = { retries: 2, baseDelayMs: 10, maxDelayMs: 50, timeoutMs: 50 };
function qloo(replies: Parameters<typeof scriptedFetch>[0], opts: Partial<ConstructorParameters<typeof HttpQlooClient>[2]> = {}) {
  const f = scriptedFetch(replies), clock = fakeClock();
  const c = new HttpQlooClient("test-key", "https://hackathon.api.qloo.com/", { retry: RETRY, ...opts }, { fetch: f.fn, clock, limiter: new RateLimiter(0, clock), random: () => 1 });
  return { c, f, clock };
}
const codeOf = async (p: Promise<unknown>) => { const e = await p.then(() => undefined, (x: unknown) => x); return e instanceof ProviderError ? e.code : `not a ProviderError: ${String(e)}`; };

beforeEach(() => cacheClear());

describe("HttpQlooClient", () => {
  it("sends X-Api-Key to the hackathon host and drops empty params", async () => {
    const { c, f } = qloo([{ body: artistDoc }]);
    await c.insights({ "filter.type": "urn:entity:artist", take: 3, skip: undefined, empty: "" });
    const call = f.calls[0]!;
    expect(call.url).toBe("https://hackathon.api.qloo.com/v2/insights?filter.type=urn%3Aentity%3Aartist&take=3");
    expect(new Headers(call.init?.headers).get("x-api-key")).toBe("test-key");
    expect(call.init?.method).toBe("GET");
  });
  it("maps heatmap cells and logs the call", async () => {
    const { c } = qloo([{ body: heatmapDoc }]);
    const cells = await c.heatmap({ "signal.interests.entities": "abc", "filter.location": "POLYGON((0 0,0 1,1 1,0 0))" });
    expect(cells[0]).toEqual({ lat: 40.5, lon: -73.75, geohash: "dr5wcb", affinity: 1, affinityRank: 0.99, popularity: 0.97, mock: false });
    expect(c.calls[0]).toMatchObject({ endpoint: "/v2/insights", status: 200, resultCount: 3, attempts: 1, params: { "filter.type": "urn:heatmap" } });
  });
  it("counts dropped items in the call log", async () => {
    const bad = structuredClone(heatmapDoc) as { results: { heatmap: unknown[] } };
    bad.results.heatmap.push({ nope: true });
    const { c } = qloo([{ body: bad }]);
    expect(await c.heatmap({})).toHaveLength(3);
    expect(c.calls[0]?.dropped).toBe(1);
  });
  it("search: parses results and treats 404 as no results", async () => {
    expect((await qloo([{ body: searchDoc }]).c.search("Example", ["urn:entity:artist"]))[0]?.name).toBe("Example Artist One");
    const { c } = qloo([{ status: 404, body: { error: "No results" } }]);
    expect(await c.search("zzz", ["urn:entity:artist"])).toEqual([]);
    expect(c.calls[0]).toMatchObject({ status: 404, error: "not_found" });
  });
  it("tags: id/name pairs", async () => {
    expect(await qloo([{ body: tagsDoc }]).c.tags("music venue", ["urn:tag:category:place"])).toEqual([{ id: "urn:tag:category:place:music_venue", name: "Music Venue" }]);
  });
  it("retries 429 then succeeds; attempts are logged", async () => {
    const { c, f } = qloo([{ status: 429 }, { body: artistDoc }]);
    expect(await c.insights({ a: 1 })).toHaveLength(2);
    expect(f.calls).toHaveLength(2);
    expect(c.calls[0]?.attempts).toBe(2);
  });
  it("auth failure: not retried, fatal, logged with status", async () => {
    const { c, f } = qloo([{ status: 401, body: { error: "bad key" } }]);
    expect(await codeOf(c.insights({}))).toBe("auth");
    expect(f.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ status: 401, error: "auth" });
  });
  it("403 (entity type not enabled) is 'forbidden': not retried, not fatal", async () => {
    const { c, f } = qloo([{ status: 403, body: { message: "You do not have permission to access urn:entity:destination" } }]);
    const e = await c.insights({ "filter.type": "urn:entity:destination" }).then(() => undefined, (x: unknown) => x as ProviderError);
    expect(e?.code).toBe("forbidden");
    expect(e?.fatal).toBe(false);
    expect(f.calls).toHaveLength(1);
  });
  it("default policy matches Qloo's client: 3 attempts, only 429/5xx retried, user-agent set", async () => {
    const f = scriptedFetch([{ status: 503 }]), clock = fakeClock();
    const c = new HttpQlooClient("k", "https://hackathon.api.qloo.com", {}, { fetch: f.fn, clock, limiter: new RateLimiter(0, clock), random: () => 1 });
    expect(await codeOf(c.insights({ a: 1 }))).toBe("upstream");
    expect(f.calls).toHaveLength(3);
    expect(new Headers(f.calls[0]?.init?.headers).get("user-agent")).toMatch(/^routed\//);
    const g = scriptedFetch([{ status: 408 }]);
    const c2 = new HttpQlooClient("k", "https://hackathon.api.qloo.com", {}, { fetch: g.fn, clock, limiter: new RateLimiter(0, clock), random: () => 1 });
    expect(await codeOf(c2.insights({ b: 1 }))).toBe("timeout");
    expect(g.calls).toHaveLength(1);
  });
  it("refuses to send the key to an untrusted or insecure base URL", () => {
    const make = (url: string, trusted?: string) => () => new HttpQlooClient("k", url, { trustedBaseUrl: trusted });
    for (const bad of ["https://evil.example.com", "http://hackathon.api.qloo.com", "https://hackathon.api.qloo.com?x=1", "https://u:p@api.qloo.com", "not a url"]) {
      expect(make(bad)).toThrow(ProviderError);
    }
    expect(make("https://staging.example.com/v", "https://staging.example.com/v/")).not.toThrow();
    expect(make("http://127.0.0.1:9", "http://127.0.0.1:9")).not.toThrow();
    expect(make("http://127.0.0.1:9")).toThrow(/QLOO_TRUSTED_BASE_URL/);
    expect(() => new HttpQlooClient("  ", "https://api.qloo.com")).toThrow(/QLOO_API_KEY/);
  });
  it("invalid JSON and wrong envelopes become invalid_response (and are not cached)", async () => {
    const { c, f } = qloo([{ body: "<html>oops</html>" }, { body: { results: "nope" } }, { body: artistDoc }]);
    expect(await codeOf(c.insights({ q: 1 }))).toBe("invalid_response");
    expect(await codeOf(c.insights({ q: 1 }))).toBe("invalid_response");
    expect(await c.insights({ q: 1 })).toHaveLength(2);
    expect(f.calls).toHaveLength(3);
  });
  it("caches parsed results per URL (cache hits don't hit the network or the budget)", async () => {
    const { c, f } = qloo([{ body: artistDoc }], { maxCallsPerRun: 1 });
    await c.insights({ q: 1 });
    await c.insights({ q: 1 });
    expect(f.calls).toHaveLength(1);
    expect(c.calls.map((x) => x.status)).toEqual([200, "cache"]);
  });
  it("enforces the per-run call budget", async () => {
    const { c } = qloo([{ body: artistDoc }], { maxCallsPerRun: 2 });
    await c.insights({ q: 1 }); await c.insights({ q: 2 });
    expect(await codeOf(c.insights({ q: 3 }))).toBe("budget");
    expect(c.calls.at(-1)).toMatchObject({ status: "error", error: "budget" });
  });
  it("timeouts surface as timeout after retries", async () => {
    const { c, f } = qloo(["hang"], { retry: { ...RETRY, timeoutMs: 5 } });
    expect(await codeOf(c.heatmap({}))).toBe("timeout");
    expect(f.calls).toHaveLength(3);
  });
});

describe("LLM response parsing", () => {
  const completion = (message: Record<string, unknown>, finish = "stop") => ({ id: "x", choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }] });

  it("reads content and tool calls", () => {
    const r = parseChatCompletion(completion({ content: "hi", tool_calls: [{ id: "c1", type: "function", function: { name: "resolve_artist", arguments: '{"name":"X"}' } }] }, "tool_calls"));
    expect(r).toEqual({ content: "hi", toolCalls: [{ id: "c1", type: "function", function: { name: "resolve_artist", arguments: '{"name":"X"}' } }], droppedToolCalls: 0, finishReason: "tool_calls" });
  });
  it("normalizes provider quirks: object arguments, missing type, empty content, null tool_calls", () => {
    const r = parseChatCompletion(completion({ content: "  ", tool_calls: [{ id: "c1", function: { name: "f", arguments: { a: 1 } } }, { id: "c2", function: { name: "g" } }] }));
    expect(r.content).toBeNull();
    expect(r.toolCalls.map((t) => t.function.arguments)).toEqual(['{"a":1}', "{}"]);
    expect(parseChatCompletion(completion({ content: null, tool_calls: null })).toolCalls).toEqual([]);
  });
  it("drops malformed tool calls but keeps the turn", () => {
    const r = parseChatCompletion(completion({ content: null, tool_calls: [{ function: { name: "noid" } }, { id: "ok", function: { name: "f", arguments: "{}" } }, "junk"] }));
    expect(r.toolCalls.map((t) => t.id)).toEqual(["ok"]);
    expect(r.droppedToolCalls).toBe(2);
  });
  it.each([["no choices", { choices: [] }], ["error body", { error: { message: "x" } }], ["null", null]])("rejects %s", (_, body) => {
    expect(() => parseChatCompletion(body)).toThrow(ProviderError);
  });
  it("parses JSON answers with fences or prose around them", () => {
    expect(parseJsonContent('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonContent('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonContent('Here you go: {"a":{"b":2}} hope that helps')).toEqual({ a: { b: 2 } });
    for (const bad of ["", null, "no json here", "{broken"]) expect(() => parseJsonContent(bad)).toThrow(ProviderError);
  });
  it("tool args: object JSON only, errors are returned not thrown", () => {
    expect(parseToolArgs('{"x":1}')).toEqual({ ok: true, value: { x: 1 } });
    expect(parseToolArgs("")).toEqual({ ok: true, value: {} });
    expect(parseToolArgs("[1]")).toMatchObject({ ok: false });
    expect(parseToolArgs("{oops")).toMatchObject({ ok: false });
  });
});

describe("OpenAICompatibleClient", () => {
  const llm = (replies: Parameters<typeof scriptedFetch>[0]) => {
    const f = scriptedFetch(replies);
    return { c: new OpenAICompatibleClient("sk-test", "https://llm.test/v1/", "m-1", RETRY, { fetch: f.fn, clock: fakeClock(), random: () => 1 }, { trustedBaseUrl: "https://llm.test/v1" }), f };
  };
  const ok = { choices: [{ message: { content: '{"stops":[]}' } }] };

  it("posts to /chat/completions with bearer auth, model and tools", async () => {
    const { c, f } = llm([{ body: ok }]);
    await c.chat([{ role: "user", content: "hi" }], []);
    const call = f.calls[0]!;
    expect(call.url).toBe("https://llm.test/v1/chat/completions");
    expect(new Headers(call.init?.headers).get("authorization")).toBe("Bearer sk-test");
    expect(JSON.parse(String(call.init?.body))).toMatchObject({ model: "m-1", tool_choice: "auto", messages: [{ role: "user", content: "hi" }] });
  });
  it("json(): uses JSON mode and parses the content", async () => {
    const { c, f } = llm([{ body: ok }]);
    expect(await c.json("sys", "user")).toEqual({ stops: [] });
    expect(JSON.parse(String(f.calls[0]?.init?.body)).response_format).toEqual({ type: "json_object" });
  });
  it("retries 5xx and 429, not 400", async () => {
    expect(await llm([{ status: 500 }, { status: 429 }, { body: ok }]).c.json("s", "u")).toEqual({ stops: [] });
    const bad = llm([{ status: 400, body: { error: "context too long" } }]);
    expect(await codeOf(bad.c.chat([], []))).toBe("bad_request");
    expect(bad.f.calls).toHaveLength(1);
  });
  it("non-JSON or wrong-shape bodies become invalid_response", async () => {
    expect(await codeOf(llm([{ body: "<html>" }]).c.chat([], []))).toBe("invalid_response");
    expect(await codeOf(llm([{ body: { choices: [{ message: { content: "not json" } }] } }]).c.json("s", "u"))).toBe("invalid_response");
  });
  it("refuses an unapproved host or empty key before any request", () => {
    expect(() => new OpenAICompatibleClient("sk", "https://llm.test/v1", "m")).toThrow(/LLM_TRUSTED_BASE_URL/);
    expect(() => new OpenAICompatibleClient("sk", "https://hackathon.api.qloo.com", "m")).toThrow(/not a known LLM API host/);
    expect(() => new OpenAICompatibleClient(" ", "https://generativelanguage.googleapis.com/v1beta/openai/", "m")).toThrow(/empty/);
  });
  it("Gemini: posts to the OpenAI-compatible path and paces calls through a shared limiter", async () => {
    const f = scriptedFetch([{ body: ok }, { body: ok }]);
    const sleeps: number[] = [];
    const clock = { now: () => 0, sleep: async (ms: number) => { sleeps.push(ms); } };
    const c = new OpenAICompatibleClient("k", "https://generativelanguage.googleapis.com/v1beta/openai/", "gemini-3.5-flash-lite", RETRY, { fetch: f.fn, clock, limiter: new RateLimiter(6500, clock) });
    await c.json("s", "u"); await c.json("s", "u");
    expect(f.calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(sleeps).toContain(6500);
  });
  it("keeps Gemini thought signatures on tool calls so they are sent back next turn", async () => {
    const sig = { google: { thought_signature: "opaque" } };
    const { c } = llm([{ body: { choices: [{ message: { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "t", arguments: "{}" }, extra_content: sig }] } }] } }]);
    const r = await c.chat([{ role: "user", content: "hi" }], []);
    expect(r.toolCalls[0]).toEqual({ id: "call_1", type: "function", function: { name: "t", arguments: "{}" }, extra_content: sig });
  });
  it("waits as long as a Gemini 429 body's retryDelay says (capped)", async () => {
    const f = scriptedFetch([{ status: 429, body: { error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "7s" }] } } }, { body: ok }]);
    const sleeps: number[] = [];
    const clock = { now: () => 0, sleep: async (ms: number) => { sleeps.push(ms); } };
    const c = new OpenAICompatibleClient("k", "https://api.openai.com/v1", "m", { ...RETRY, maxDelayMs: 30000 }, { fetch: f.fn, clock, random: () => 1 });
    expect(await c.json("s", "u")).toEqual({ stops: [] });
    expect(sleeps).toEqual([7000]);
  });
  it("errors name the LLM provider", async () => {
    const e = await llm([{ status: 401 }]).c.chat([], []).catch((x: unknown) => x);
    expect(e).toMatchObject({ provider: "llm", code: "auth" });
  });
});
