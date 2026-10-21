import { describe, expect, it } from "vitest";
import { backoffMs, codeForStatus, redact, requestWithRetry, retryAfterMs, type RetryPolicy } from "@/lib/net/http";
import { RateLimiter, sharedLimiter } from "@/lib/net/rate-limiter";
import { ProviderError, userMessage, type ErrorCode } from "@/lib/net/errors";
import { fakeClock, scriptedFetch } from "./helpers";

const POLICY: RetryPolicy = { retries: 3, baseDelayMs: 100, maxDelayMs: 2000, timeoutMs: 50 };
const run = (replies: Parameters<typeof scriptedFetch>[0], policy = POLICY) => {
  const f = scriptedFetch(replies), clock = fakeClock();
  const p = requestWithRetry("qloo", "https://api.example.test/v2/insights?x=1", { method: "GET" }, policy, { fetch: f.fn, clock, random: () => 1 });
  return { p, f, clock };
};
const rejectsWith = async (p: Promise<unknown>, code: ErrorCode) => {
  const e = await p.then(() => undefined, (x: unknown) => x);
  expect(e).toBeInstanceOf(ProviderError);
  expect((e as ProviderError).code).toBe(code);
  return e as ProviderError;
};

describe("requestWithRetry", () => {
  it("returns the first 2xx", async () => {
    const { p, f } = run([{ body: { ok: 1 } }]);
    await expect(p).resolves.toMatchObject({ status: 200, text: '{"ok":1}', attempts: 1 });
    expect(f.calls).toHaveLength(1);
  });
  it("retries 429 and 5xx with exponential backoff, then succeeds", async () => {
    const { p, f, clock } = run([{ status: 429 }, { status: 503 }, { status: 502 }, { body: {} }]);
    await expect(p).resolves.toMatchObject({ attempts: 4 });
    expect(f.calls).toHaveLength(4);
    expect(clock.sleeps).toEqual([100, 200, 400]); // random()=1 -> full delay
  });
  it("honours Retry-After (seconds) over the backoff, capped at maxDelayMs", async () => {
    const { p, clock } = run([{ status: 429, headers: { "retry-after": "1" } }, { status: 429, headers: { "retry-after": "30" } }, { body: {} }]);
    await p;
    expect(clock.sleeps).toEqual([1000, 2000]);
  });
  it("gives up after the retry budget with the last error's code and attempt count", async () => {
    const { p, f } = run([{ status: 429 }]);
    const e = await rejectsWith(p, "rate_limited");
    expect(f.calls).toHaveLength(4);
    expect(e.attempts).toBe(4);
    expect(e.status).toBe(429);
    expect(e.fatal).toBe(true);
    expect(e.userMessage).toMatch(/after 4 attempts/);
  });
  it.each([[401, "auth"], [403, "forbidden"], [404, "not_found"], [400, "bad_request"], [422, "bad_request"]] as const)("does not retry HTTP %i (%s)", async (status, code) => {
    const { p, f } = run([{ status }]);
    await rejectsWith(p, code);
    expect(f.calls).toHaveLength(1);
  });
  it("retries network errors, then reports network", async () => {
    const { p, f } = run(["network"]);
    await rejectsWith(p, "network");
    expect(f.calls).toHaveLength(4);
  });
  it("recovers from a transient network error", async () => {
    const { p } = run(["network", { body: {} }]);
    await expect(p).resolves.toMatchObject({ attempts: 2 });
  });
  it("times out a hung request (per attempt) and retries", async () => {
    const { p, f } = run(["hang", "hang", { body: { late: true } }], { ...POLICY, timeoutMs: 15 });
    await expect(p).resolves.toMatchObject({ attempts: 3 });
    expect(f.calls).toHaveLength(3);
  });
  it("reports timeout when every attempt hangs", async () => {
    const { p } = run(["hang"], { ...POLICY, retries: 1, timeoutMs: 10 });
    const e = await rejectsWith(p, "timeout");
    expect(e.detail).toMatch(/timed out after 10 ms/);
  });
  it("passes an abort signal to fetch and never leaks the query string into errors", async () => {
    const { p, f } = run([{ status: 400, body: "bad" }]);
    const e = await rejectsWith(p, "bad_request");
    expect(f.calls[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    expect(e.message).not.toContain("x=1");
    expect(e.message).toContain("https://api.example.test/v2/insights");
  });
  it("retryOn narrows which statuses are retried", async () => {
    const { p, f } = run([{ status: 408 }, { body: {} }], { ...POLICY, retryOn: new Set([429, 503]) });
    await rejectsWith(p, "timeout");
    expect(f.calls).toHaveLength(1);
  });
  it("rejects oversized bodies (declared or actual) as invalid_response without retrying", async () => {
    const big = run([{ body: "x".repeat(200) }], { ...POLICY, maxBodyBytes: 100 });
    await rejectsWith(big.p, "invalid_response");
    expect(big.f.calls).toHaveLength(1);
    const declared = run([{ body: "{}", headers: { "content-length": "999999" } }], { ...POLICY, maxBodyBytes: 100 });
    const e = await rejectsWith(declared.p, "invalid_response");
    expect(e.detail).toMatch(/999999 bytes exceeds 100/);
  });
  it("waits on the rate limiter before every attempt", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(200, clock);
    const f = scriptedFetch([{ status: 500 }, { body: {} }]);
    await requestWithRetry("llm", "https://x.test/", {}, { ...POLICY, baseDelayMs: 0 }, { fetch: f.fn, clock, limiter, random: () => 0 });
    expect(clock.sleeps.filter((s) => s > 0)).toEqual([200]); // 2nd attempt waited for its slot
  });
});

describe("retry helpers", () => {
  it("maps status codes", () => {
    expect([401, 403, 404, 408, 429, 500, 503, 418].map((s) => codeForStatus(s))).toEqual(["auth", "auth", "not_found", "timeout", "rate_limited", "upstream", "upstream", "bad_request"]);
  });
  it("a Qloo 403 is 'forbidden' (entity type not enabled), not a dead key", () => {
    expect(codeForStatus(403, "qloo")).toBe("forbidden");
    expect(codeForStatus(401, "qloo")).toBe("auth");
    expect(codeForStatus(403, "llm")).toBe("auth");
    const e = new ProviderError("qloo", "forbidden", "x", 403);
    expect(e.fatal).toBe(false);
    expect(e.retryable).toBe(false);
    expect(e.userMessage).toMatch(/not enabled/);
  });
  it("parses Retry-After seconds and HTTP dates", () => {
    expect(retryAfterMs(null, 0)).toBeUndefined();
    expect(retryAfterMs("2", 0)).toBe(2000);
    expect(retryAfterMs("soon", 0)).toBeUndefined();
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(retryAfterMs("Mon, 19 Oct 2026 12:00:05 GMT", now)).toBe(5000);
    expect(retryAfterMs("Mon, 19 Oct 2026 11:00:00 GMT", now)).toBe(0);
  });
  it("backoff doubles, is jittered into [50%, 100%], and is capped", () => {
    const p = { retries: 5, baseDelayMs: 100, maxDelayMs: 500, timeoutMs: 1 };
    expect([0, 1, 2, 3].map((a) => backoffMs(a, p, () => 1))).toEqual([100, 200, 400, 500]);
    expect(backoffMs(1, p, () => 0)).toBe(100);
  });
  it("redact keeps origin + path only", () => {
    expect(redact("https://h.test/v2/insights?api_key=SECRET&x=1")).toBe("https://h.test/v2/insights");
    expect(redact("not a url")).toBe("(invalid url)");
  });
});

describe("RateLimiter", () => {
  it("spaces request starts by minIntervalMs, FIFO", async () => {
    // Frozen clock: all five callers arrive at the same instant and must queue behind each other.
    const sleeps: number[] = [];
    const l = new RateLimiter(220, { now: () => 0, sleep: async (ms) => { sleeps.push(ms); } });
    await Promise.all(Array.from({ length: 5 }, () => l.acquire()));
    expect(sleeps).toEqual([220, 440, 660, 880]);
  });
  it("does not wait when calls are already spaced out", async () => {
    const clock = fakeClock();
    const l = new RateLimiter(200, clock);
    await l.acquire(); clock.advance(500); await l.acquire();
    expect(clock.sleeps).toEqual([]);
  });
  it("caps throughput at ~5 req/s with real timers", async () => {
    const l = new RateLimiter(50);
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 5 }, () => l.acquire()));
    expect(Date.now() - t0).toBeGreaterThanOrEqual(190);
  });
  it("rejects a negative interval and shares one limiter per key", () => {
    expect(() => new RateLimiter(-1)).toThrow(RangeError);
    expect(sharedLimiter("k", 100)).toBe(sharedLimiter("k", 100));
    expect(sharedLimiter("k", 100)).not.toBe(sharedLimiter("other", 100));
  });
});

describe("ProviderError", () => {
  it("classifies retryable and fatal codes", () => {
    const e = (c: ErrorCode) => new ProviderError("qloo", c, "d");
    expect(["timeout", "rate_limited", "upstream", "network"].every((c) => e(c as ErrorCode).retryable)).toBe(true);
    expect(e("auth").retryable).toBe(false);
    expect(["auth", "rate_limited", "budget"].every((c) => e(c as ErrorCode).fatal)).toBe(true);
    expect(e("invalid_response").fatal).toBe(false);
  });
  it("has a user message for every code, naming the provider, never the detail", () => {
    const codes: ErrorCode[] = ["timeout", "rate_limited", "auth", "not_found", "bad_request", "upstream", "network", "invalid_response", "budget"];
    for (const c of codes) for (const p of ["qloo", "llm"] as const) {
      const m = userMessage(p, c, 500, 2);
      expect(m.length).toBeGreaterThan(10);
      expect(m).toMatch(p === "qloo" ? /Qloo/ : /language model/);
    }
    expect(new ProviderError("qloo", "auth", "key=abc123", 401).userMessage).not.toContain("abc123");
    expect(userMessage("qloo", "auth", 401)).toMatch(/QLOO_API_KEY/);
    expect(userMessage("llm", "auth", 401)).toMatch(/LLM_API_KEY/);
  });
});
