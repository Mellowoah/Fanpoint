/** The readability pass: plain-English labels, the folded agent trace, and map labels that never overlap. */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import AgentTrace from "@/components/AgentTrace";
import { FanScore } from "@/components/FanScore";
import { FillStats, STATUS_LABEL } from "@/components/FillViews";
import { labelBox, labelWidth, placeLabels } from "@/components/MapView";
import { runAgent } from "@/lib/agent/run";
import type { AgentEvent, FillPlan } from "@/lib/agent/types";
import { MockQlooClient } from "@/lib/qloo/mock-client";
import { MockLlmClient } from "@/lib/llm/mock";
import { scoreLine } from "@/lib/route/score-line";

const DEMO = { task: "fill" as const, artist: "Marigold Static", maxDriveMi: 350, minAffinity: 0.6,
  anchors: [{ city: "New York", date: "2026-11-13" }, { city: "Durham", date: "2026-11-21" }, { city: "Atlanta", date: "2026-11-28" }] };
async function run() { const ev: AgentEvent[] = []; for await (const e of runAgent(DEMO, { qloo: new MockQlooClient([0, 0]), llm: new MockLlmClient(0) })) ev.push(e); return ev; }

describe("agent trace", () => {
  it("is folded behind 'Show trace', with a one-sentence description and no raw requests visible", async () => {
    const ev = await run();
    const html = renderToStaticMarkup(createElement(AgentTrace, { events: ev, title: "What the agent did" }));
    expect(html).toContain("Show trace");
    expect(html).toContain("Every Qloo API call this run made, in order");
    expect(html).not.toContain(">GET<"); // request lines only render after the toggle
    expect(html).toContain("Find the artist in Qloo"); // plain step labels stay visible
  });
});

describe("plain-English labels", () => {
  it("score line reads as fan strength, with the exact Qloo line kept in the tooltip", () => {
    const html = renderToStaticMarkup(createElement(FanScore, { affinity: 0.934 }));
    expect(html).toContain("Fan strength here");
    expect(html).toContain("93 / 100");
    expect(html).toContain(`title="${scoreLine("with", 0.934)}"`);
    expect(renderToStaticMarkup(createElement(FanScore, { mode: "without" }))).toContain("No fan data");
    expect(renderToStaticMarkup(createElement(FanScore, { affinity: 0.5, kind: "act" }))).toContain("How strongly these fans overlap");
  });
  it("stats name what each number means and keep the numbers", async () => {
    const plan = (await run()).find((e): e is Extract<AgentEvent, { type: "result" }> => e.type === "result")!.plan as FillPlan;
    const html = renderToStaticMarkup(createElement(FillStats, { q: plan }));
    expect(html).toContain("Open dates we filled");
    expect(html).toContain(`${plan.result.fills} of ${plan.result.offBefore}`);
    expect(html).toContain("Shows that broke touring limits");
    expect(plan.summary).toMatch(/^Filled \d+ of \d+ open dates/);
  });
  it("every candidate status has a plain label", () => {
    for (const v of Object.values(STATUS_LABEL)) expect(v).toMatch(/^[a-z][a-z ()]+$/);
  });
});

describe("map labels", () => {
  const box = (p: { x: number; y: number }, s: { text: string; dir: "left" | "right" | "top" | "bottom" }) => labelBox(p.x, p.y, labelWidth(s.text), 20, s.dir);
  it("a tight cluster (Durham, Winston-Salem, Asheville...) gets labels that never overlap", () => {
    const pts = [
      { x: 300, y: 300, label: "★ Durham · Nov 21", short: "★", priority: 1 },
      { x: 270, y: 305, label: "5. Winston-Salem · 95", short: "5" },
      { x: 255, y: 318, label: "6. Charlotte · 96", short: "6" },
      { x: 225, y: 322, label: "8. Asheville · 100", short: "8" },
      { x: 262, y: 330, label: "7. Columbia, SC · 96", short: "7" },
      { x: 330, y: 260, label: "4. Richmond · 99", short: "4" },
    ];
    const out = placeLabels(pts, { w: 800, h: 550 }, pts);
    const boxes = out.flatMap((s, i) => (s ? [box(pts[i]!, s)] : []));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
    }
    expect(out[0]?.text).toBe("★ Durham · Nov 21"); // the booked show keeps its full label
    expect(out.filter(Boolean).length).toBeGreaterThanOrEqual(4);
  });
  it("labels stay inside the map", () => {
    const [s] = placeLabels([{ x: 795, y: 10, label: "1. Somewhere long · 99" }], { w: 800, h: 550 });
    const b = box({ x: 795, y: 10 }, s!);
    expect(b.x0).toBeGreaterThanOrEqual(0); expect(b.x1).toBeLessThanOrEqual(800); expect(b.y0).toBeGreaterThanOrEqual(0);
  });
});
