import { describe, expect, it } from "vitest";
import { runAgent } from "@/lib/agent/run";
import type { AgentEvent, FillPlan, FillRequest } from "@/lib/agent/types";
import { MockQlooClient } from "@/lib/qloo/mock-client";
import { MockLlmClient } from "@/lib/llm/mock";
import { allHolds, holdDraft, holdMailto, holdText } from "@/lib/client/holds";
import { foldLine, icsEscape, planToIcs } from "@/lib/client/ics";
import { scoreLine } from "@/lib/route/score-line";
import { BENCHMARK } from "@/lib/benchmark";

const DEMO: FillRequest = {
  task: "fill", artist: "Marigold Static", maxDriveMi: 350, minAffinity: 0.6,
  anchors: [{ city: "New York", date: "2026-11-13", label: "Record release" }, { city: "Durham", date: "2026-11-21" }, { city: "Atlanta", date: "2026-11-28" }],
};
async function demoPlan(): Promise<FillPlan> {
  for await (const e of runAgent(DEMO, { qloo: new MockQlooClient([0, 0]), llm: new MockLlmClient(0) }) as AsyncGenerator<AgentEvent>)
    if (e.type === "result") return e.plan as FillPlan;
  throw new Error("no plan");
}

/** Minimal RFC 5545 reader: unfold, split into components, check structure. */
function parseIcs(text: string) {
  expect(text.endsWith("\r\n")).toBe(true);
  expect(/[^\r]\n/.test(text)).toBe(false); // CRLF only
  const raw = text.split("\r\n");
  for (const l of raw) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
  const lines = text.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
  const stack: string[] = []; const events: Record<string, string>[] = []; let cur: Record<string, string> | null = null;
  for (const l of lines) {
    const i = l.indexOf(":"); expect(i).toBeGreaterThan(0);
    const name = l.slice(0, i), value = l.slice(i + 1);
    if (name === "BEGIN") { stack.push(value); if (value === "VEVENT") cur = {}; }
    else if (name === "END") { expect(stack.pop()).toBe(value); if (value === "VEVENT") { events.push(cur!); cur = null; } }
    else if (cur) cur[name.split(";")[0]!] = value;
  }
  expect(stack).toEqual([]);
  return { lines, events };
}

describe("benchmark constant", () => {
  it("holds aggregates only, with the measurement note", () => {
    expect(BENCHMARK.note).toBe("measured 2026-10-21, 10 artists, live Qloo + Gemini");
    expect(BENCHMARK.fanpoint.nights).toEqual({ min: 5, max: 10, median: 7 });
    expect(BENCHMARK.fanpoint.longestRun.max).toBeLessThanOrEqual(BENCHMARK.maxConsecutiveShows);
    expect(JSON.stringify(BENCHMARK)).not.toMatch(/Japanese|Big Thief|Khruangbin|Philadelphia|Camden/);
  });
});

describe("hold drafts", () => {
  it("builds a deterministic hold for every filled stop, addressed to the top Qloo room", async () => {
    const q = await demoPlan();
    expect(q.stops.length).toBeGreaterThan(0);
    const s = q.stops[0]!;
    const h = holdDraft(q, s);
    expect(h).toEqual(holdDraft(q, s));
    expect(h.subject).toContain(q.artist.name);
    expect(h.subject).toContain(s.city);
    expect(h.body).toMatch(/^Hi Talent buyer,/);
    const v = s.venues[0]!;
    expect(h.body).toContain(`hold at ${v.name} (${v.place!.address}) for ${q.artist.name}`);
    expect(h.body).not.toContain("[Venue]");
    expect(h.subject).toContain(v.name);
    expect(h.body).toContain("Why your room:");
    expect(h.body).toContain(scoreLine("with", s.affinity));
    expect(h.body).toContain(`coming from ${s.prevCity} (${s.driveMi} road mi`);
    expect(h.body).toMatch(/going on to /);
    if (s.support[0]) expect(h.body).toContain(`Possible support: ${s.support[0].name}.`);
    expect(holdText(h).startsWith(`Subject: ${h.subject}\n\n`)).toBe(true);
    const m = holdMailto(h);
    expect(m.startsWith("mailto:?subject=")).toBe(true);
    expect(decodeURIComponent(m.split("&body=")[1]!)).toBe(h.body);
    expect(allHolds(q).split("\n\n----------\n\n")).toHaveLength(q.stops.length);
  });

  it("falls back to the [Venue] placeholder without a room, and names a room's own city across a line", async () => {
    const q = await demoPlan();
    const s = q.stops[0]!;
    const none = holdDraft(q, { ...s, venues: [], room: undefined });
    expect(none.body).toContain(`hold at [Venue] for ${q.artist.name}`);
    expect(none.body).not.toContain("Why your room");
    const v = { ...s.venues[0]!, city: "Philadelphia", region: "PA", place: { ...s.venues[0]!.place, address: undefined } };
    const across = holdDraft(q, { ...s, city: "Camden", venues: [v], room: { why: "", hood: { name: "Example Village", how: "named" } } });
    expect(across.body).toContain(`hold at ${v.name} for ${q.artist.name}`);
    expect(across.body).toContain("in Philadelphia, PA (our Camden stop).");
    expect(across.body).toContain("in Example Village, where those fans cluster.");
  });
});

describe("calendar export (.ics)", () => {
  it("escapes TEXT and folds at 75 octets without splitting characters", () => {
    expect(icsEscape("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    const long = "DESCRIPTION:" + "é".repeat(80);
    const folded = foldLine(long);
    for (const l of folded.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, "")).toBe(long);
  });
  it("parses, has one all-day event per calendar day, stable UIDs", async () => {
    const q = await demoPlan();
    const stamp = new Date("2026-10-21T12:00:00Z");
    const text = planToIcs(q, stamp);
    const { lines, events } = parseIcs(text);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(events).toHaveLength(q.result.calendar.length);
    const kinds = (k: string) => q.result.calendar.filter((d) => d.kind === k).length;
    expect(events.filter((e) => e.SUMMARY!.includes("proposed fill"))).toHaveLength(kinds("fill"));
    expect(events.filter((e) => e.SUMMARY!.includes("off / travel day"))).toHaveLength(kinds("off"));
    for (const e of events) {
      expect(e.DTSTART).toMatch(/^\d{8}$/); expect(e.DTEND).toMatch(/^\d{8}$/); expect(e.DTSTAMP).toBe("20261021T120000Z");
      expect(e.UID).toMatch(/@fanpoint$/);
    }
    expect(new Set(events.map((e) => e.UID)).size).toBe(events.length);
    expect(planToIcs(q, stamp)).toBe(text);
  });
});
