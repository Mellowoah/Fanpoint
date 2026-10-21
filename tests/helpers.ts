import type { Anchor, Candidate } from "@/lib/route/fill";
import { gcMi, type LatLon } from "@/lib/route/geo";
import type { RoadFn } from "@/lib/route/road";

/**
 * Road double for unit tests on synthetic coordinates: 1.2 x great-circle miles at 50 mph. Production code uses the
 * OSRM matrix (route/road.ts); tests on real markets use that too.
 */
export const testMi = (a: LatLon, b: LatLon) => gcMi(a, b) * 1.2;
export const testRoad: RoadFn = (a, b) => ({ mi: testMi(a, b), hours: testMi(a, b) / 50 });

/** Deterministic PRNG (mulberry32) for property-style tests. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Points on the 35°N parallel: 1° of longitude ≈ 56.7 great-circle miles there. */
export const anchor = (city: string, lon: number, date: string, lat = 35): Anchor => ({ city, lat, lon, date });
export const cand = (name: string, lon: number, affinity: number, lat = 35): Candidate => ({ name, lat, lon, affinity });

/** A flat week of weights, so tests that are not about night-of-week aren't affected by it. */
export const FLAT = [1, 1, 1, 1, 1, 1, 1];

/** Virtual clock: sleep() resolves immediately but advances now() and records each wait. */
export function fakeClock(start = 1_000_000) {
  let t = start;
  const sleeps: number[] = [];
  return { sleeps, now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, advance: (ms: number) => { t += ms; } };
}

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> } | "network" | "hang";
/** fetch stand-in that answers from a script, one reply per call (the last reply repeats). */
export function scriptedFetch(replies: Reply[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    if (r === "network") throw new TypeError("fetch failed");
    if (r === "hang") return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return new Response(body, { status: r.status ?? 200, headers: r.headers });
  }) as typeof fetch;
  return { fn, calls };
}
