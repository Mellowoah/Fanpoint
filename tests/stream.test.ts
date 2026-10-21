import { describe, expect, it } from "vitest";
import { httpErrorEvent, parseEventLine, streamPlan } from "@/lib/client/stream";
import type { AgentEvent } from "@/lib/agent/types";

/** Response whose body arrives in the given chunks (to exercise line splitting). */
const chunked = (chunks: string[], status = 200) => new Response(new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } }), { status });
const run = async (fetchImpl: typeof fetch, opts: { timeoutMs?: number; signal?: AbortSignal } = {}) => {
  const ev: AgentEvent[] = [];
  await streamPlan({ task: "fill" }, (e) => ev.push(e), { fetchImpl, ...opts });
  return ev;
};
const result = '{"type":"result","plan":{}}';

describe("streamPlan", () => {
  it("parses events split across chunks and a final line without newline", async () => {
    const ev = await run(async () => chunked(['{"type":"thou', 'ght","text":"a"}\n{"type":"step","id":"x","label":"l","status":"done"}\n', result]));
    expect(ev.map((e) => e.type)).toEqual(["thought", "step", "result"]);
  });
  it("skips unreadable lines but still delivers the result", async () => {
    const ev = await run(async () => chunked(["garbage\n", "[1,2]\n", result + "\n"]));
    expect(ev.map((e) => e.type)).toEqual(["result"]);
  });
  it("reports a stream that ends without a result", async () => {
    const ev = await run(async () => chunked(['{"type":"thought","text":"a"}\n']));
    expect(ev.at(-1)).toMatchObject({ type: "error", code: "incomplete", retryable: true });
  });
  it("mentions unreadable data when that is why nothing arrived", async () => {
    const ev = await run(async () => chunked(["<html>proxy error</html>"]));
    expect(ev.at(-1)).toMatchObject({ code: "incomplete", message: expect.stringMatching(/could not read/) });
  });
  it("passes server error events through without adding another", async () => {
    const ev = await run(async () => chunked(['{"type":"error","code":"auth","message":"bad key","retryable":false}\n']));
    expect(ev).toEqual([{ type: "error", code: "auth", message: "bad key", retryable: false }]);
  });
  it("turns validation 400s into a non-retryable form error", async () => {
    const ev = await run(async () => Response.json({ error: { code: "invalid_request", message: "anchors.0.city: pick a city" } }, { status: 400 }));
    expect(ev).toEqual([{ type: "error", code: "invalid_request", message: "Please fix the form: anchors.0.city: pick a city", retryable: false }]);
  });
  it("network failures become a network error", async () => {
    const ev = await run(async () => { throw new TypeError("Failed to fetch"); });
    expect(ev).toEqual([expect.objectContaining({ code: "network", retryable: true })]);
  });
  it("times out a hung server", async () => {
    const hang = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as typeof fetch;
    const ev = await run(hang, { timeoutMs: 10 });
    expect(ev).toEqual([expect.objectContaining({ code: "timeout" })]);
  });
  it("user cancellation is silent", async () => {
    const ctrl = new AbortController();
    const hang = ((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))) as typeof fetch;
    const p = run(hang, { signal: ctrl.signal });
    ctrl.abort();
    expect(await p).toEqual([]);
  });
});

describe("helpers", () => {
  it("parseEventLine accepts only objects with a type", () => {
    expect(parseEventLine('{"type":"thought","text":"x"}')).toEqual({ type: "thought", text: "x" });
    for (const bad of ["", "null", "1", '{"no":"type"}', "{bad"]) expect(parseEventLine(bad)).toBeUndefined();
  });
  it("httpErrorEvent handles non-JSON error bodies and other statuses", async () => {
    expect(await httpErrorEvent(new Response("<html>", { status: 502 }))).toMatchObject({ code: "internal", message: "The server answered HTTP 502. Try again." });
    expect(await httpErrorEvent(Response.json({ error: { message: "too big" } }, { status: 413 }))).toMatchObject({ code: "invalid_request", message: "too big", retryable: false });
  });
});
