/**
 * MOCK LLM (no API key needed). A deterministic, scripted stand-in for the real model so the full agent loop
 * (tool calls, tool results, final submit) runs end to end. It reads the actual tool results in the conversation
 * and templates its text from them. Its notes are labeled "(mock LLM)" in the UI.
 * With LLM_API_KEY set, the identical loop is driven by a real OpenAI-compatible model instead.
 */
import { simulatePlainFill } from "./plain-sim";
import type { FillGapsOut, GeoOut, IntelOut, PeersOut, ResolveOut, ScanOut, Slim, ToolError } from "../agent/tools";
import type { ChatMessage, ChatResult, LlmClient, ToolCall, ToolDef } from "./types";

interface MockRequest { task?: "fill" | "cohead"; artist?: string; partner?: string; anchors?: { city: string; date: string }[]; maxDriveMi?: number; minAffinity?: number }
type Results = <T>(name: string) => (T | ToolError)[];
const ok = <T,>(xs: (T | ToolError)[]): T[] => xs.filter((x): x is T => !(typeof x === "object" && x !== null && "error" in x));
const pct = (x?: number) => (x === undefined ? "?" : `${Math.round(x * 100)}`);
const afterMarker = (s: string | null | undefined): unknown => { try { return JSON.parse((s ?? "").split("REQUEST_JSON:")[1] ?? "{}"); } catch { return {}; } };

export class MockLlmClient implements LlmClient {
  readonly mode = "mock" as const;
  readonly model = "scripted-mock";
  private seq = 0;
  /** Simulated model latency in ms (0 in tests). */
  constructor(private readonly latencyMs = 150) {}

  private call(name: string, args: unknown): ToolCall { return { id: `mock_call_${++this.seq}`, type: "function", function: { name, arguments: JSON.stringify(args) } }; }
  private wait(ms: number) { return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve(); }

  async chat(messages: ChatMessage[], _tools: ToolDef[]): Promise<ChatResult> {
    await this.wait(this.latencyMs);
    const req = afterMarker(messages.find((m) => m.role === "user")?.content) as MockRequest;
    const results: Results = <T,>(name: string) => {
      const ids = new Set(messages.flatMap((m) => m.tool_calls ?? []).filter((c) => c.function.name === name).map((c) => c.id));
      return messages.filter((m) => m.role === "tool" && ids.has(m.tool_call_id ?? "")).map((m) => JSON.parse(m.content ?? "{}") as T | ToolError);
    };
    const resolved = results<ResolveOut>("resolve_artist");
    const first = resolved[0];
    if (!first) return { content: `(mock LLM) Resolving "${req.artist}" to a Qloo entity first; every later call uses its id.`, toolCalls: [this.call("resolve_artist", { name: req.artist })] };
    if ("error" in first) return { content: `(mock LLM) ${first.error}`, toolCalls: [] };
    const artist = first.artist;
    if (req.task === "cohead" && req.partner && resolved.length < 2)
      return { content: `(mock LLM) Also resolving the proposed partner "${req.partner}".`, toolCalls: [this.call("resolve_artist", { name: req.partner, role: "partner" })] };
    return req.task === "cohead" ? this.cohead(artist, results) : this.fill(req, artist, results);
  }

  private fill(req: MockRequest, artist: Slim, results: Results): ChatResult {
    const anchors = req.anchors ?? [];
    const scans = ok(results<ScanOut>("scan_corridor"));
    if (!results<ScanOut>("scan_corridor").length) {
      const legs = anchors.slice(0, -1).map((a, i) => [a.city, anchors[i + 1]?.city ?? a.city] as const);
      return { content: `(mock LLM) ${legs.length} gaps between anchors. Reading ${artist.name}'s Qloo fan heatmap inside each drive corridor.`,
        toolCalls: legs.map(([f, t]) => this.call("scan_corridor", { artist_id: artist.id, from_city: f, to_city: t })) };
    }
    const fillRes = results<FillGapsOut>("fill_gaps")[0];
    if (!fillRes) return { content: `(mock LLM) Filling off days at max ${req.maxDriveMi} mi/day, no doubling back, weighting Thu-Sat nights higher.`, toolCalls: [this.call("fill_gaps", {})] };
    if ("error" in fillRes) return { content: `(mock LLM) ${fillRes.error}`, toolCalls: [] };
    const fills = fillRes.calendar.filter((d) => d.kind === "fill");
    const intelAll = results<IntelOut>("get_city_intel");
    const intel = ok(intelAll);
    if (!intelAll.length && fills.length)
      return { content: `(mock LLM) ${fills.length} off days filled (${fillRes.off_days_before} → ${fillRes.off_days_after} off). Pulling a support act, rooms and promo hooks for each fill.`,
        toolCalls: fills.map((f) => this.call("get_city_intel", { artist_id: artist.id, city: f.city })) };
    const ranks = new Map<string, { rank: number; corridor: string }>();
    for (const s of scans) for (const c of s.cities) ranks.set(c.name, { rank: c.rank, corridor: s.corridor });
    const prevOf = new Map<string, string>();
    let last = anchors[0]?.city ?? "";
    for (const d of fillRes.calendar) if (d.city && d.kind !== "off") { prevOf.set(d.date, last); last = d.city; }
    const out = fills.map((f) => {
      const prev = prevOf.get(f.date) ?? "";
      const ci = intel.find((x) => x.city === f.city);
      const r = f.city ? ranks.get(f.city) : undefined;
      const sup = ci?.support[0], v = ci?.venues[0], brand = ci?.brands[0], pod = ci?.podcasts[0];
      const note = `A ${f.dow} stop ${f.drive_mi} road miles from ${prev}, where fan heat is ${pct(f.fan_heat)}${r ? ` (#${r.rank} in the ${r.corridor} corridor)` : ""}.${sup ? ` ${sup.name} fits as local support${v ? `, and ${v.name} is the best-matched room` : ""}.` : ""}`;
      return {
        city: f.city, note,
        promo: [
          ...(brand ? [{ entity_id: brand.id, angle: `Ticket-stub offer or merch table collab with ${brand.name}, a top brand for this audience in ${f.city}.` }] : []),
          ...(pod ? [{ entity_id: pod.id, angle: `Pitch a guest spot on ${pod.name} the week before.` }] : []),
        ],
      };
    });
    return { content: "(mock LLM) Submitting notes. The routing, picks and numbers are already fixed by the tools.",
      toolCalls: [this.call("submit_fill", { summary: `${out.length} of ${fillRes.off_days_before} off days filled with strong-fan cities; longest drive day ${fillRes.max_daily_drive_mi} road miles (${fillRes.max_daily_drive_hours} h); no backtracking.`, fills: out })] };
  }

  private cohead(artist: Slim, results: Results): ChatResult {
    const peersRes = results<PeersOut>("find_peer_acts")[0];
    if (!peersRes) return { content: `(mock LLM) Looking for peer acts in ${artist.name}'s popularity band.`, toolCalls: [this.call("find_peer_acts", { artist_id: artist.id })] };
    if ("error" in peersRes) return { content: `(mock LLM) ${peersRes.error}`, toolCalls: [] };
    const geo = results<GeoOut>("compare_fan_geography")[0];
    if (!geo) return { content: `(mock LLM) ${peersRes.peers.length} peers. Comparing nationwide fan heatmaps, looking for coverage, not similarity.`,
      toolCalls: [this.call("compare_fan_geography", { artist_id: artist.id })] };
    if ("error" in geo) return { content: `(mock LLM) ${geo.error}`, toolCalls: [] };
    const ranked = geo.peers;
    const mostSimilar = [...ranked].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))[0];
    const chosen = [...ranked.slice(0, 3), ...ranked.filter((p, i) => p.requested && i >= 3)];
    const pitches = chosen.map((p) => ({
      peer_id: p.id,
      pitch: `Co-headline with ${p.name}: you gain strong rooms in ${p.cities_you_gain.slice(0, 4).join(", ") || "few new cities"}, and they gain ${p.cities_they_gain.slice(0, 4).join(", ") || "few"}. Only ${p.overlap} cities overlap.${mostSimilar && mostSimilar.id !== p.id ? ` The most similar act, ${mostSimilar.name}, overlaps in ${mostSimilar.overlap} cities and adds ${mostSimilar.cities_you_gain.length}.` : ""}`,
    }));
    return { content: "(mock LLM) Writing pitches for the top-ranked partners.", toolCalls: [this.call("submit_cohead", { summary: `Best co-headline: ${ranked[0]?.name ?? "none"}, whose fans are strong where ${artist.name}'s are weak.`, pitches })] };
  }

  async json(_system: string, user: string): Promise<unknown> {
    await this.wait(this.latencyMs * 2.5);
    const req = afterMarker(user) as { anchors?: { city: string; date: string }[] };
    return simulatePlainFill({ anchors: req.anchors ?? [] });
  }
}
