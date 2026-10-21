import { describe, expect, it } from "vitest";
import { checkQlooBaseUrl, QLOO_HACKATHON_BASE_URL } from "@/lib/qloo/base-url";
import { checkLlmBaseUrl, defaultLlmIntervalMs, GEMINI_OPENAI_BASE_URL } from "@/lib/llm/base-url";
import { retryDelayFromBody } from "@/lib/net/http";

describe("checkQlooBaseUrl (the key only goes to approved hosts)", () => {
  it("accepts the known Qloo hosts over https and normalizes trailing slashes", () => {
    expect(checkQlooBaseUrl(QLOO_HACKATHON_BASE_URL)).toEqual({ ok: true, url: "https://hackathon.api.qloo.com" });
    expect(checkQlooBaseUrl("https://api.qloo.com/")).toEqual({ ok: true, url: "https://api.qloo.com" });
  });
  it.each([
    ["http://hackathon.api.qloo.com", /https/],
    ["https://hackathon.api.qloo.com:8443", /not a known/],
    ["https://hackathon.api.qloo.com.evil.io", /not a known/],
    ["https://api.qloo.com/?k=1", /query/],
    ["https://api.qloo.com/#f", /fragment/],
    ["https://me:pw@api.qloo.com", /credentials/],
    ["ftp://api.qloo.com", /https/],
    ["::", /valid URL/],
  ])("rejects %s", (url, reason) => {
    const r = checkQlooBaseUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(reason);
  });
  it("other hosts need an exact QLOO_TRUSTED_BASE_URL match", () => {
    expect(checkQlooBaseUrl("https://proxy.example.com/qloo", "https://proxy.example.com/qloo/").ok).toBe(true);
    expect(checkQlooBaseUrl("https://proxy.example.com/qloo", "https://proxy.example.com/other").ok).toBe(false);
    expect(checkQlooBaseUrl("https://proxy.example.com", "garbage").ok).toBe(false);
    expect(checkQlooBaseUrl("http://localhost:4010", "http://localhost:4010").ok).toBe(true);
  });
});

describe("checkLlmBaseUrl (LLM_API_KEY only goes to approved LLM hosts)", () => {
  it("accepts Gemini's OpenAI-compatible endpoint and OpenAI", () => {
    expect(checkLlmBaseUrl(GEMINI_OPENAI_BASE_URL)).toEqual({ ok: true, url: "https://generativelanguage.googleapis.com/v1beta/openai" });
    expect(checkLlmBaseUrl("https://api.openai.com/v1").ok).toBe(true);
  });
  it("rejects other hosts unless LLM_TRUSTED_BASE_URL matches exactly", () => {
    expect(checkLlmBaseUrl("https://openrouter.ai/api/v1").ok).toBe(false);
    expect(checkLlmBaseUrl("https://openrouter.ai/api/v1", "https://openrouter.ai/api/v1/").ok).toBe(true);
    expect(checkLlmBaseUrl("http://generativelanguage.googleapis.com/v1beta/openai/").ok).toBe(false);
    expect(checkLlmBaseUrl("https://generativelanguage.googleapis.com.evil.io/v1beta/openai/").ok).toBe(false);
    expect(checkLlmBaseUrl("https://generativelanguage.googleapis.com/v1beta/openai/?key=x").ok).toBe(false);
  });
  it("keys do not cross: Google is not a Qloo host, Qloo is not an LLM host", () => {
    expect(checkQlooBaseUrl(GEMINI_OPENAI_BASE_URL).ok).toBe(false);
    expect(checkLlmBaseUrl(QLOO_HACKATHON_BASE_URL).ok).toBe(false);
    expect(checkLlmBaseUrl("https://api.qloo.com").ok).toBe(false);
  });
  it("paces only Gemini by default", () => {
    expect(defaultLlmIntervalMs(GEMINI_OPENAI_BASE_URL)).toBe(6500);
    expect(defaultLlmIntervalMs("https://api.openai.com/v1")).toBe(0);
    expect(defaultLlmIntervalMs("::")).toBe(0);
  });
  it("reads Google's RetryInfo.retryDelay from a 429 body", () => {
    expect(retryDelayFromBody('{"error":{"details":[{"retryDelay": "34s"}]}}')).toBe(34000);
    expect(retryDelayFromBody('{"retryDelay":"1.5s"}')).toBe(1500);
    expect(retryDelayFromBody("nope")).toBeUndefined();
  });
});
