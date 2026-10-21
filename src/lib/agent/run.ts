/** The Routed agent loop: LLM <-> tools until a submit tool is called, streaming events for the UI trace. */
import { createLlmClient, type ChatMessage, type LlmClient, type ToolDef } from "../llm";
import { parseToolArgs } from "../llm/schemas";
import { createQlooClient } from "../qloo";
import type { QlooClient } from "../qloo/types";
import { findCity } from "../route/cities";
import { DEFAULT_PARAMS, type Anchor, type FillParams } from "../route/fill";
import { osrmRoads } from "../route/road";
import { vetText } from "./narrative";
import { agentError, toErrorEvent } from "./errors";
import { createGrounder } from "./grounding";
import { COHEAD_TOOLS, FILL_TOOLS, Registry, SubmitCoheadSchema, SubmitFillSchema, Tools } from "./tools";
import { THRESHOLDS } from "../cohead/complementarity";
import { RULE_VALUES } from "../touring/rules";
import type { Entity } from "../qloo/types";
import type { AgentEvent, CoheadPlan, FillPlan, FillRequest, FillStop, PeerMatch, PlanRequest, Providers } from "./types";

const FILL_SYSTEM = `You are Routed, a routing assistant for booking agents and promoters.
The tour has fixed ANCHOR shows (city + date). Routed's tools fill the off days between anchors with shows in cities
where this artist's Qloo fan heat is strongest, using OSRM road distances and cited touring rules. You orchestrate the
tools and explain the result; you do not decide it.
Process: 1) resolve_artist 2) scan_corridor for EACH consecutive anchor pair 3) fill_gaps 4) get_city_intel for EACH
filled city 5) submit_fill.
In submit_fill write a short plain-language note per fill city and a one-line promo angle per brand/podcast id.
Use only facts and numbers that appear in tool results; a note with any other number is discarded. Do not forecast
ticket sales or claim venue capacities (no source has them). If a tool returns an error, continue without that data.`;

const COHEAD_SYSTEM = `You are Routed, a co-headline matchmaker for booking agents and promoters.
Routed's tools rank peer acts by how well their Qloo fan geography COVERS this artist's weak cities (and vice versa).
Process: 1) resolve_artist (and resolve_artist role=partner if the user named a second act) 2) find_peer_acts
3) compare_fan_geography 4) submit_cohead with a pitch for each of the top 3 ranked peers and the user's named partner.
In each pitch, name the cities each side gains and contrast with the most similar peer. Use only names and numbers from
tool results; a pitch with any other number is discarded. No ticket forecasts.`;

const LABELS: Record<string, string> = {
  resolve_artist: "Resolve artist in Qloo", scan_corridor: "Scan fan heat along each drive corridor", fill_gaps: "Fill off days (drive, no-backtrack, night-of-week rules)",
  get_city_intel: "Support acts, rooms & promo hooks per fill", submit_fill: "Grounding & number check, final routing",
  find_peer_acts: "Find peer acts in your popularity band", compare_fan_geography: "Compare nationwide fan geography", submit_cohead: "Grounding & number check, recommendation",
};
/** Tool results longer than this are summarized before they go back to the model (keeps prompts bounded). */
const MAX_TOOL_CHARS = 12000;

export interface AgentDeps {
  qloo: QlooClient;
  llm: LlmClient;
  /** Model turns before giving up (each turn may call several tools). */
  maxTurns: number;
  /** Wall-clock budget for the whole run. */
  deadlineMs: number;
}

/** Map request anchors onto known touring cities (validated upstream), sorted by date. */
export function resolveAnchors(req: Pick<FillRequest, "anchors">): Anchor[] {
  return req.anchors.flatMap((a) => { const c = findCity(a.city); return c ? [{ id: c.id, city: c.name, region: c.region, lat: c.lat, lon: c.lon, date: a.date, label: a.label }] : []; })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** JSON for a tool message; oversized results are replaced by a valid JSON stub rather than cut mid-string. */
export function toolContent(out: unknown): string {
  const s = JSON.stringify(out) ?? "null";
  return s.length <= MAX_TOOL_CHARS ? s : JSON.stringify({ truncated: true, note: `Result was ${s.length} chars; showing the start.`, preview: s.slice(0, MAX_TOOL_CHARS - 200) });
}

export async function* runAgent(req: PlanRequest, deps: Partial<AgentDeps> = {}): AsyncGenerator<AgentEvent> {
  try {
    yield* loop(req, { qloo: deps.qloo ?? createQlooClient(), llm: deps.llm ?? createLlmClient(), maxTurns: deps.maxTurns ?? 10, deadlineMs: deps.deadlineMs ?? 150_000 });
  } catch (e) {
    yield toErrorEvent(e);
  }
}

async function* loop(req: PlanRequest, { qloo: q, llm, maxTurns, deadlineMs }: AgentDeps): AsyncGenerator<AgentEvent> {
  const t0 = Date.now();
  const reg = new Registry();
  const anchors = req.task === "fill" ? resolveAnchors(req) : [];
  const params = req.task === "fill" ? fillParams(req) : undefined;
  const roads = osrmRoads();
  const tools = new Tools(q, reg, anchors, params, { leg: roads.leg, source: `${roads.meta.engine}; ${roads.meta.data}` });
  const defs: ToolDef[] = req.task === "fill" ? FILL_TOOLS : COHEAD_TOOLS;
  const userText = req.task === "fill"
    ? `Artist: "${req.artist}". Anchors: ${anchors.map((a) => `${a.date} ${a.city}${a.label ? ` (${a.label})` : ""}`).join("; ")}. Max drive ${params?.maxDriveMi} road mi and ${params?.maxDriveHours} h per day, at most ${params?.maxConsecutiveShows} shows in a row, fan-heat floor ${params?.minAffinity}.`
    : `Artist: "${req.artist}".${req.partner ? ` Proposed partner: "${req.partner}".` : ""} Find the best co-headliner by complementary fan geography.`;
  // REQUEST_JSON gives the scripted mock model a machine-readable copy; a real model just reads the prose.
  const messages: ChatMessage[] = [
    { role: "system", content: req.task === "fill" ? FILL_SYSTEM : COHEAD_SYSTEM },
    { role: "user", content: `${userText}\nREQUEST_JSON:${JSON.stringify({ ...req, anchors })}` },
  ];
  const providers: Providers = { qloo: q.mode, llm: llm.mode, model: llm.model };

  for (let turn = 0; turn < maxTurns; turn++) {
    if (Date.now() - t0 > deadlineMs) { yield agentError(`The run took longer than ${Math.round(deadlineMs / 1000)} s and was stopped.`, "timeout"); return; }
    const res = await llm.chat(messages, defs);
    if (res.content) yield { type: "thought", text: res.content };
    if (!res.toolCalls.length) { yield agentError(res.content ? `The agent stopped without a plan: ${res.content.slice(0, 300)}` : "The agent stopped without a plan."); return; }
    messages.push({ role: "assistant", content: res.content, tool_calls: res.toolCalls });
    const names = [...new Set(res.toolCalls.map((c) => c.function.name))];
    for (const nm of names) yield { type: "step", id: nm, label: LABELS[nm] ?? nm, status: "running" };

    // Tool calls run one after another so each trace line lists exactly its own Qloo requests
    // (live requests are rate-limited anyway; requests inside one tool still run in parallel).
    for (const c of res.toolCalls) {
      const name = c.function.name;
      const args = parseToolArgs(c.function.arguments);
      const reply = (content: unknown) => messages.push({ role: "tool", tool_call_id: c.id, name, content: toolContent(content) });
      if (!args.ok) { reply({ error: args.error }); continue; }

      if (name === "submit_fill" || name === "submit_cohead") {
        if (name === "submit_fill" && req.task === "fill" && reg.fill && reg.artist) {
          // Intel for every fill comes from Qloo whether or not the model asked for it.
          for (const d of reg.fill.calendar) {
            if (d.kind !== "fill" || !d.city || reg.intel.has(d.city.toLowerCase())) continue;
            const before = q.calls.length;
            const r = await tools.call("get_city_intel", { artist_id: reg.artist.id, city: d.city });
            yield { type: "tool", name: "get_city_intel", args: { artist_id: reg.artist.id, city: d.city, auto: true }, summary: `${r.summary} (fetched by Routed: the model skipped it)`, qlooCalls: q.calls.slice(before) };
          }
        }
        const plan = name === "submit_fill" && req.task === "fill" ? buildFill(args.value, reg, anchors, q, providers, roads.meta)
          : name === "submit_cohead" && req.task === "cohead" ? buildCohead(args.value, reg, q, providers)
          : { error: `${name} does not match this request.` };
        if ("error" in plan) { reply(plan); continue; }
        yield { type: "step", id: name, label: LABELS[name] ?? name, status: "done", detail: `${plan.grounding.grounded}/${plan.grounding.referenced} references grounded in Qloo results${plan.warnings.some((w) => w.startsWith("AI text")) ? "; some AI text dropped (numbers not in the data)" : ""}` };
        yield { type: "result", plan };
        return;
      }
      const before = q.calls.length;
      const r = await tools.call(name, args.value); // fatal provider errors throw out of the loop on purpose
      yield { type: "tool", name, args: args.value, summary: r.summary, qlooCalls: q.calls.slice(before) };
      reply(r.out);
    }
    for (const nm of names) if (!nm.startsWith("submit_")) yield { type: "step", id: nm, label: LABELS[nm] ?? nm, status: "done" };
  }
  yield agentError(`The agent used all ${maxTurns} turns without submitting a plan.`);
}

/** The request's limits merged over the cited defaults (touring/rules.ts). */
export function fillParams(req: Pick<FillRequest, "maxDriveMi" | "minAffinity" | "rules">): Required<FillParams> {
  return { ...DEFAULT_PARAMS, ...stripUndefined(req.rules ?? {}), maxDriveMi: req.maxDriveMi, minAffinity: req.minAffinity };
}
const stripUndefined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const pct = (x: number) => Math.round(x * 100);
const fmtPop = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(n));

/**
 * Assembly for Fill the gaps. Every decision and number comes from tool state: the cities and dates (fill_gaps), the
 * support act, rooms and promo partners (top Qloo results per city), the explanation text (built from the data). The
 * model's notes and angles are kept only if every number in them matches the data (narrative.ts).
 */
export function buildFill(args: unknown, reg: Registry, anchors: Anchor[], q: Pick<QlooClient, "calls">, providers: Providers, routing: FillPlan["routing"]): FillPlan | { error: string } {
  const parsed = SubmitFillSchema.safeParse(args);
  if (!parsed.success) return { error: `Invalid submit_fill: ${parsed.error.issues[0]?.message ?? "bad shape"}` };
  if (!reg.fill || !reg.artist) return { error: "Call fill_gaps before submit_fill." };
  const g = createGrounder(reg.entities);
  const warnings = [...reg.warnings];
  const notes = new Map(parsed.data.fills.map((f) => [f.city.toLowerCase(), f]));
  const fill = reg.fill, p = fill.params;
  const corridorOf = (date: string) => {
    const i = anchors.findIndex((a) => a.date > date);
    const a = anchors[i - 1], b = anchors[i];
    return a && b ? reg.corridors.get(`${a.city}>${b.city}`) : undefined;
  };
  const tourFacts = [fill.fills, fill.offBefore, fill.offAfter, fill.offBefore - fill.offAfter, fill.gaps.length, fill.maxDayDrive, fill.maxDayHours, fill.totalMi, fill.totalHours, fill.longestRun,
    p.maxDriveMi, p.maxDriveHours, p.maxConsecutiveShows, p.radiusMi, p.minAffinity, anchors.length, ...anchors.map((a) => a.date)];
  const allFacts: (number | string | undefined)[] = [...tourFacts];
  let prevCity = anchors[0]?.city ?? "";
  const stops: FillStop[] = [];
  for (const d of fill.calendar) {
    if (d.kind === "anchor") { prevCity = d.city ?? prevCity; continue; }
    if (d.kind !== "fill" || !d.city || d.lat === undefined || d.lon === undefined || d.affinity === undefined) continue;
    const m = findCity(d.city);
    const intel = reg.intel.get(d.city.toLowerCase());
    const size = corridorOf(d.date)?.candidates.length;
    const support = (intel?.support ?? []).slice(0, 1), venues = (intel?.venues ?? []).slice(0, 2);
    const promoEntities = [intel?.brands[0], intel?.podcasts[0]].filter((e): e is Entity => !!e && !!g.pick(e.id));
    const facts = [...tourFacts, d.date, d.affinity, d.rankInCorridor, size, d.driveMi, d.driveHours, d.driveDays, d.dowWeight, d.run,
      m?.population, m?.metro.population, m?.venues.total, m?.venues.theatre, m?.venues.nightclub, m?.venues.music_venue, m?.venues.live_music,
      ...[...support, ...venues, ...promoEntities].flatMap((e) => [e.affinity, e.popularity])];
    allFacts.push(...facts);
    const t = notes.get(d.city.toLowerCase());
    const note = vetText(t?.note, facts);
    if (!note.ok) warnings.push(`AI text dropped for ${d.city}: it used numbers not in the data (${note.offending.join(", ")}).`);
    const promo = promoEntities.map((e) => {
      const a = vetText(t?.promo.find((x) => x.entity_id === e.id)?.angle, facts);
      if (!a.ok) warnings.push(`AI promo angle dropped for ${e.name}: numbers not in the data (${a.offending.join(", ")}).`);
      return a.ok && a.text
        ? { entity: e, angle: a.text, angleBy: "ai" as const }
        : { entity: e, angle: `${e.name} is the top Qloo ${e.kind === "podcast" ? "podcast" : "brand"} for this artist's audience in ${d.city}.`, angleBy: "routed" as const };
    });
    const rank = d.rankInCorridor !== undefined ? ` (#${d.rankInCorridor}${size ? ` of ${size}` : ""} in the corridor)` : "";
    stops.push({
      date: d.date, dow: d.dow, city: d.city, cityId: d.id ?? m?.id, region: d.region, lat: d.lat, lon: d.lon, affinity: d.affinity, rankInCorridor: d.rankInCorridor,
      corridorSize: size, dowWeight: d.dowWeight ?? 0, driveMi: d.driveMi ?? 0, driveHours: d.driveHours, driveDays: d.driveDays ?? 1, prevCity, run: d.run,
      headline: `${d.dow} ${d.city}: Qloo fan heat ${pct(d.affinity)}${rank}`,
      why: [
        `${d.driveMi ?? 0} road mi / ${d.driveHours ?? "?"} h from ${prevCity}${(d.driveDays ?? 1) > 1 ? ` over ${d.driveDays} days` : ""} (OSRM).`,
        m ? `City population ${fmtPop(m.population)}, metro ${fmtPop(m.metro.population)} (Census 2025).` : "",
        m ? `${m.venues.total} mapped live-music venues and theatres within 10 mi (OSM).` : "",
        support[0] ? `Top Qloo support match: ${support[0].name}.` : "",
      ].filter(Boolean).join(" "),
      aiNote: note.ok && note.text ? note.text : undefined,
      support: g.pickAll(support.map((e) => e.id)), venues: g.pickAll(venues.map((e) => e.id)), promo,
    });
    prevCity = d.city;
  }
  const summary = `${stops.length} of ${fill.offBefore} off days filled (${fill.offAfter} left). Longest drive day ${fill.maxDayDrive} road mi / ${fill.maxDayHours} h; `
    + `total ${fill.totalMi} mi; at most ${fill.longestRun} shows in a row. Limits: ${p.maxDriveMi} mi and ${p.maxDriveHours} h per day, ${p.maxConsecutiveShows} shows in a row, fan heat at least ${pct(p.minAffinity)}.`;
  const ai = vetText(parsed.data.summary, allFacts);
  if (!ai.ok) warnings.push(`AI text dropped for the summary: it used numbers not in the data (${ai.offending.join(", ")}).`);
  return {
    task: "fill", mode: "qloo", artist: reg.artist, anchors, params: p, result: fill, stops, corridors: [...reg.corridors.values()], ranked: reg.ranked ?? [], rules: { ...RULE_VALUES },
    summary, aiSummary: ai.ok && ai.text ? ai.text : undefined, routing, grounding: g.report(), warnings, qlooCalls: [...q.calls], providers,
  };
}

const peerFacts = (m: PeerMatch) => [m.score, m.similarity, m.youGain.length, m.theyGain.length, m.overlap.length, m.coveredStrong, m.youStrong, m.themStrong, m.newStrongForYou, m.newStrongForThem,
  m.entity.affinity, m.entity.popularity, THRESHOLDS.strong, THRESHOLDS.weak];

/**
 * Assembly for co-headliner matching. The ranking and "recommended" flag come from compare_fan_geography (top 3 with a
 * positive score); the model only writes pitches, which are kept if every number in them matches that peer's data.
 */
export function buildCohead(args: unknown, reg: Registry, q: Pick<QlooClient, "calls">, providers: Providers): CoheadPlan | { error: string } {
  const parsed = SubmitCoheadSchema.safeParse(args);
  if (!parsed.success) return { error: `Invalid submit_cohead: ${parsed.error.issues[0]?.message ?? "bad shape"}` };
  if (!reg.artist || !reg.matches.length) return { error: "Call compare_fan_geography before submit_cohead." };
  const g = createGrounder(reg.entities);
  const warnings = [...reg.warnings];
  const peers = reg.matches.map((m, i) => ({ ...m, picked: m.score > 0 && i < 3, pitch: undefined as string | undefined }));
  const mostSimilar = [...peers].sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1))[0];
  for (const p of parsed.data.pitches) {
    if (!g.pick(p.peer_id)) continue;
    const m = peers.find((x) => x.entity.id === p.peer_id);
    if (!m) continue;
    const v = vetText(p.pitch, [...peerFacts(m), ...(mostSimilar ? peerFacts(mostSimilar) : []), peers.length, peers.indexOf(m) + 1]);
    if (v.ok) m.pitch = v.text;
    else warnings.push(`AI pitch dropped for ${m.entity.name}: it used numbers not in the data (${v.offending.join(", ")}).`);
  }
  const you = reg.geo.get(reg.artist.id) ?? new Map<string, { name: string; region: string; lat: number; lon: number; affinity: number }>();
  const cities = [...you.values()].map((c) => ({
    name: c.name, region: c.region, lat: c.lat, lon: c.lon, you: c.affinity,
    peers: Object.fromEntries(peers.map((p) => [p.entity.id, reg.geo.get(p.entity.id)?.get(c.name)?.affinity ?? null])),
  }));
  const top = peers.find((p) => p.picked);
  const summary = top
    ? `Best co-headline by fan-geography coverage: ${top.entity.name} (score ${top.score}). ${reg.artist.name} gains ${top.youGain.length} strong cities, ${top.entity.name} gains ${top.theyGain.length}, ${top.overlap.length} overlap.`
    : `No peer covers ${reg.artist.name}'s weak cities (no positive complementarity score).`;
  const all = peers.flatMap(peerFacts);
  const ai = vetText(parsed.data.summary, [...all, peers.length]);
  if (!ai.ok) warnings.push(`AI text dropped for the summary: it used numbers not in the data (${ai.offending.join(", ")}).`);
  return { task: "cohead", artist: reg.artist, peers, thresholds: { ...THRESHOLDS }, rules: { ...RULE_VALUES }, cities, summary, aiSummary: ai.ok && ai.text ? ai.text : undefined,
    grounding: g.report(), warnings, qlooCalls: [...q.calls], providers };
}
