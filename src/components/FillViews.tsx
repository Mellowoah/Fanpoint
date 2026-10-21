"use client";
import { useMemo } from "react";
import type { Entity } from "@/lib/qloo/types";
import type { FillPlan, FillStop, PlainFillPlan } from "@/lib/agent/types";
import type { Day, GapPlan } from "@/lib/route/fill";
import { censusUrl, findMarket, MARKETS_META, marketById, osmUrl } from "@/lib/data/markets";
import { RULES } from "@/lib/touring/rules";
import { KindBadge } from "./SourcesPanel";
import type { RankMode, RankedGap } from "@/lib/route/rank";
import { scoreLine } from "@/lib/route/score-line";
import type { Marker } from "./MapView";
import WhyPopover from "./WhyPopover";
import { CYAN } from "./palette";

const pct = (a?: number) => (a === undefined ? "–" : `${Math.round(a * 100)}`);
const md = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** All Qloo corridor reads from the run, by city name (used to score ANY city, including plain-AI picks). */
export function corridorHeat(q?: FillPlan) {
  const m = new Map<string, { affinity: number; rank: number; corridor: string }>();
  for (const c of q?.corridors ?? []) for (const x of c.candidates) if (!m.has(x.name)) m.set(x.name, { affinity: x.affinity, rank: x.rank, corridor: `${c.from}→${c.to}` });
  return m;
}

// ---------- Calendar (signature strip) ----------
export function FillCalendar({ days, plain, flagged }: { days: Day[]; plain?: boolean; flagged?: Set<string> }) {
  return (
    <div className="overflow-x-auto">
      <div className="grid grid-flow-col auto-cols-[minmax(68px,1fr)] gap-1 min-w-max">
        {days.map((d) => {
          const bad = flagged?.has(d.date);
          const cls = d.kind === "anchor" ? "bg-white/10 border-white/60" : d.kind === "fill" ? (plain ? `bg-plain/10 ${bad ? "border-red-500" : "border-plain/50"}` : "bg-accent/15 border-accent/70") : "border-line bg-[repeating-linear-gradient(135deg,var(--panel),var(--panel)_6px,var(--background)_6px,var(--background)_12px)]";
          return (
            <div key={d.date} className={`border rounded-md p-1.5 text-[11px] leading-tight h-[92px] flex flex-col ${cls}`}>
              <div className="flex justify-between text-plain"><span>{d.dow}</span><span>{md(d.date)}</span></div>
              {d.kind === "off" ? <div className="m-auto text-plain/70 font-mono">OFF</div> : (
                <>
                  <div className="font-semibold mt-1 truncate" title={d.city}>{d.city}</div>
                  {d.kind === "anchor" ? <div className="text-[10px] text-plain truncate">{d.label ?? "anchor"}</div>
                    : d.affinity !== undefined ? <div className={`font-mono ${plain ? "text-plain" : "text-accent"}`}>heat {pct(d.affinity)}</div> : <div className="text-[10px] text-plain">no data</div>}
                  {d.driveMi !== undefined && <div className={`mt-auto text-[10px] ${bad ? "text-red-400" : "text-plain"}`}>{d.driveMi} mi{d.driveHours !== undefined ? ` · ${d.driveHours}h` : ""}{d.driveDays && d.driveDays > 1 ? ` / ${d.driveDays}d` : ""}</div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function FillStats({ q }: { q: FillPlan }) {
  const r = q.result;
  const items: [string, string][] = [
    ["Off days", `${r.offBefore} → ${r.offAfter}`],
    ["Fills", `${r.fills}`],
    ["Longest drive day", `${r.maxDayDrive} mi · ${r.maxDayHours} h`],
    ["Most shows in a row", `${r.longestRun}`],
    ["Rules", `≤${q.params.maxDriveMi} mi & ≤${q.params.maxDriveHours} h/day · ≤${q.params.maxConsecutiveShows} in a row · no backtracking · ${q.params.radiusMi} mi radius`],
  ];
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 md:grid-cols-[auto_auto_auto_auto_1fr] gap-x-6 gap-y-1 text-sm">
        {items.map(([k, v]) => <div key={k} className={k === "Rules" ? "col-span-2 md:col-span-1" : undefined}><div className="text-[10px] uppercase tracking-wide text-plain">{k}</div><div className={k === "Off days" ? "text-xl font-bold text-accent font-mono" : "font-mono"}>{v}</div></div>)}
      </div>
      <div className="text-[11px] text-plain">Road miles and hours: OSRM car profile on OpenStreetMap data (free-flow, no stops).</div>
    </div>
  );
}

// ---------- The filter that removes unrealistic cities ----------
const STATUS_STYLE: Record<string, string> = {
  picked: "text-accent", "didn't fit schedule": "text-plain", "below heat floor": "text-plain line-through",
  "radius clause": "text-red-300 line-through", "off route / backtrack": "text-red-300 line-through", "used elsewhere": "text-plain line-through",
  "no road route": "text-red-300 line-through", "no mapped venue": "text-red-300 line-through",
};
export function CandidateFilter({ gaps, maxDriveMi }: { gaps: GapPlan[]; maxDriveMi: number }) {
  return (
    <div className="card bg-panel p-4 grid gap-3 text-sm">
      <div className="flex justify-between flex-wrap gap-2">
        <h3 className="font-semibold">Corridor candidates → realistic fills</h3>
        <span className="text-xs text-plain">Ranked by Qloo heatmap fan heat · filtered in code: radius clause, backtracking, real venue (OSM), heat floor, ≤{maxDriveMi} road mi/day (OSRM)</span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {gaps.map((g) => (
          <div key={g.from + g.to} className="grid gap-1">
            <div className="text-xs text-plain">{g.from} → {g.to} · direct {g.directMi} road mi ({g.directHours} h) · {g.offDays} off days · {g.considered.length} cities scanned</div>
            <div className="grid grid-cols-[1fr_44px_1.3fr] gap-x-2 text-xs">
              {g.considered.slice(0, 12).map((c) => (
                <div key={c.name} className="contents">
                  <span className={STATUS_STYLE[c.status]}>{c.name}</span>
                  <span className="font-mono text-right">{pct(c.affinity)}</span>
                  <span className={c.status === "picked" ? "text-accent" : c.status === "didn't fit schedule" ? "text-plain" : "text-red-300"}>{c.status}{c.detail ? ` (${c.detail})` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Maps ----------
export function useFillMap(q?: FillPlan) {
  return useMemo(() => {
    if (!q) return null;
    const cells = q.corridors.flatMap((c) => c.cells);
    const rings = q.corridors.map((c) => c.ring);
    const seq = q.result.calendar.filter((d) => d.kind !== "off" && d.lat !== undefined).map((d) => ({ lat: d.lat!, lon: d.lon! }));
    let n = 0;
    const markers: Marker[] = q.result.calendar.filter((d) => d.kind !== "off").map((d) => d.kind === "anchor"
      ? { lat: d.lat!, lon: d.lon!, color: "#ffffff", radius: 8, label: `★ ${d.city} · ${md(d.date)}`, dir: "left" as const }
      : { lat: d.lat!, lon: d.lon!, color: CYAN, label: `${++n}. ${d.city} ${pct(d.affinity)}` });
    return { cells, rings, paths: [{ pts: seq, color: CYAN, dash: "6 6" }], markers, fit: rings.flat() };
  }, [q]);
}

// ---------- Stop card ----------
function Chip({ e }: { e: Entity }) {
  return <span title={e.id} className="inline-flex items-center gap-1 bg-black/30 border border-line rounded-full px-2 py-0.5 text-xs">{e.name}{e.affinity !== undefined && <span className="text-accent font-mono">{pct(e.affinity)}</span>}</span>;
}
const KIND: Record<string, string> = { brand: "Brand", podcast: "Podcast", tv_show: "TV" };
const num = (n: number) => n.toLocaleString("en-US");
const Src = ({ children, href }: { children: React.ReactNode; href?: string }) => href
  ? <a href={href} target="_blank" rel="noreferrer" className="text-[10px] text-plain underline underline-offset-2 hover:text-accent">{children}</a>
  : <span className="text-[10px] text-plain">{children}</span>;

/** The facts behind one recommendation, each with its source. */
function WhyFacts({ s }: { s: FillStop }) {
  const m = marketById(s.cityId) ?? findMarket(s.city);
  const rows: { k: string; v: React.ReactNode; src: React.ReactNode }[] = [
    { k: "Fan heat", v: <><b className="text-accent">{pct(s.affinity)}</b>{s.rankInCorridor ? <> · #{s.rankInCorridor} of {s.corridorSize} in corridor</> : null}</>, src: <Src href="https://docs.qloo.com/">Qloo heatmap</Src> },
    { k: "Road", v: <>{s.driveMi} mi · {s.driveHours ?? "–"} h from {s.prevCity}{s.driveDays > 1 ? ` (${s.driveDays} days)` : ""}</>, src: <Src href="https://project-osrm.org/">OSRM · © OSM</Src> },
    { k: "Night", v: <>{s.dow} weight {s.dowWeight}{s.run ? ` · show ${s.run} in a row` : ""}</>, src: <KindBadge kind={RULES.dowWeights.kind} /> },
  ];
  if (m) {
    rows.push({ k: "Population", v: <>{num(m.population)} city · {num(m.metro.population)} metro <span className="text-plain">({m.metro.title})</span></>, src: <Src href={censusUrl(m)}>Census V2025</Src> });
    rows.push({ k: "Venues", v: <>{m.venues.total} mapped within {MARKETS_META.venueRadiusMi} mi <span className="text-plain">({m.venues.theatre} theatres, {m.venues.nightclub} clubs, {m.venues.music_venue + m.venues.live_music} music)</span></>, src: <Src href={osmUrl(m)}>OpenStreetMap</Src> });
  }
  return (
    <dl className="grid grid-cols-[72px_1fr_auto] gap-x-2 gap-y-1 text-xs bg-black/20 border border-line rounded-lg p-2.5">
      {rows.map(({ k, v, src }) => <div key={k} className="contents"><dt className="text-plain">{k}</dt><dd>{v}</dd><dd className="text-right">{src}</dd></div>)}
    </dl>
  );
}

export function FillStopCard({ s }: { s: FillStop }) {
  return (
    <article className="card bg-panel p-4 grid gap-2.5">
      <header className="flex justify-between gap-2">
        <div>
          <div className="text-xs text-plain">{s.dow} {md(s.date)} · {s.driveMi} road mi / {s.driveHours ?? "–"} h from {s.prevCity}{s.driveDays > 1 ? ` over ${s.driveDays} days` : ""}</div>
          <h4 className="text-lg font-semibold">{s.city}{s.region && <span className="text-plain font-normal">, {s.region}</span>}</h4>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-accent font-mono">{pct(s.affinity)}</div>
          <div className="text-[10px] text-plain uppercase tracking-wide">fan heat{s.rankInCorridor ? ` · #${s.rankInCorridor}/${s.corridorSize}` : ""}</div>
        </div>
      </header>
      <div className="text-xs font-mono text-accent" data-score-line>{scoreLine("with", s.affinity)}</div>
      <div className="grid gap-1"><div className="text-[10px] uppercase tracking-wide text-plain">Why this stop</div><WhyFacts s={s} /></div>
      {s.aiNote && <div className="text-sm leading-snug flex items-center gap-1.5"><span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-line text-plain" title="Written by the LLM; every number in it was checked against the data above">AI note</span><WhyPopover label={`AI note for ${s.city}`}>{s.aiNote}</WhyPopover></div>}
      <div className="flex flex-wrap items-center gap-1.5"><span className="text-[10px] uppercase tracking-wide text-plain w-14">Support</span>{s.support.map((e) => <Chip key={e.id} e={e} />)}<Src>top Qloo match</Src></div>
      <div className="flex flex-wrap items-center gap-1.5"><span className="text-[10px] uppercase tracking-wide text-plain w-14">Rooms</span>{s.venues.map((e) => <Chip key={e.id} e={e} />)}<Src>top Qloo matches</Src></div>
      {s.promo.map((p) => (
        <div key={p.entity.id} className="text-sm flex gap-2"><span className="text-[10px] mt-0.5 px-1.5 rounded bg-accent/15 text-accent h-fit">{KIND[p.entity.kind] ?? p.entity.kind}</span>{p.angleBy === "ai" ? <span className="flex items-center gap-1.5"><span className="text-[10px] text-plain">(AI)</span><WhyPopover label={`promo angle: ${p.entity.name}`} title="Angle">{p.angle}</WhyPopover></span> : <span>{p.angle}</span>}</div>
      ))}
    </article>
  );
}

/** Deterministic summary plus the model's (number-checked) version, clearly labelled. */
export function FillSummary({ q }: { q: FillPlan }) {
  return (
    <div className="grid gap-1 text-sm">
      <p>{q.summary}</p>
      {q.aiSummary && <p className="text-plain"><span className="text-[10px] mr-1.5 px-1.5 py-0.5 rounded bg-white/5 border border-line align-middle">AI summary</span>{q.aiSummary}</p>}
    </div>
  );
}

// ---------- Plain AI ----------
export function plainCalendar(p: PlainFillPlan, q?: FillPlan): { days: Day[]; flagged: Set<string> } {
  const heat = corridorHeat(q);
  const audit = new Map(p.audit.map((a) => [a.date, a]));
  const flagged = new Set(p.audit.filter((a) => !a.anchor && (a.overDrive || a.doublesBack || a.radiusConflict || a.dateConflict)).map((a) => a.date));
  const base = q?.result.calendar ?? [];
  const byDate = new Map(p.stops.map((s) => [s.date, s]));
  const days: Day[] = base.map((d) => {
    if (d.kind === "anchor") return { ...d, driveMi: audit.get(d.date)?.driveMi, driveHours: audit.get(d.date)?.driveHours, driveDays: undefined };
    const s = byDate.get(d.date);
    if (!s) return { date: d.date, dow: d.dow, kind: "off" };
    const a = audit.get(d.date);
    return { date: d.date, dow: d.dow, kind: "fill", city: s.city, region: s.region, lat: s.lat, lon: s.lon, affinity: heat.get(s.city)?.affinity, driveMi: a?.driveMi, driveHours: a?.driveHours };
  });
  return { days, flagged };
}

export function PlainAudit({ p, q }: { p: PlainFillPlan; q?: FillPlan }) {
  const heat = corridorHeat(q);
  return (
    <div className="card bg-panel border-dashed overflow-hidden text-sm">
      <div className="grid grid-cols-[90px_1.2fr_1.5fr_90px_2fr] bg-black/30 text-[10px] uppercase tracking-wide text-plain">
        <div className="p-2">Date</div><div className="p-2">City</div><div className="p-2">Venue (as suggested)</div><div className="p-2">Qloo heat</div><div className="p-2">Audit</div>
      </div>
      {p.stops.map((s) => {
        const a = p.audit.find((x) => x.date === s.date && x.city === s.city);
        const h = heat.get(s.city);
        const flags = [a?.dateConflict, a?.radiusConflict && `inside ${a.radiusConflict} radius clause`, a?.doublesBack && "doubles back", a?.overDrive && `${a.perDay} mi/day${a.driveHours !== undefined ? ` (${a.driveHours} h)` : ""}`, a?.noRoute && "no road route", !a?.mapped && "unknown city"]
          .filter((f): f is string => typeof f === "string" && f.length > 0);
        return (
          <div key={s.date + s.city} className="grid grid-cols-[90px_1.2fr_1.5fr_90px_2fr] border-t border-line">
            <div className="p-2 text-plain">{md(s.date)}</div><div className="p-2">{s.city}</div>
            <div className="p-2 text-plain italic">{s.venue} <span className="not-italic text-[10px] text-red-300">· not a Qloo entity</span></div>
            <div className="p-2 font-mono">{h ? pct(h.affinity) : <span className="text-plain text-xs">not in corridor</span>}</div>
            <div className="p-2 text-xs">{flags.length ? <span className="text-red-400">{flags.join(" · ")}</span> : <span className="text-plain">passes drive rules</span>}</div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Compare ----------
export function FillCompare({ q, p }: { q?: FillPlan; p?: PlainFillPlan }) {
  if (!q || !p) return <div className="text-sm text-plain">Waiting for both plans…</div>;
  const heat = corridorHeat(q);
  const avg = (xs: (number | undefined)[]) => { const v = xs.filter((x): x is number => x !== undefined); return v.length ? `${Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100)}` : "–"; };
  const pScored = p.stops.map((s) => heat.get(s.city)?.affinity);
  const outside = pScored.filter((x) => x === undefined).length;
  const weak = pScored.filter((x) => x !== undefined && x < q.params.minAffinity).length;
  const cnt = (f: (a: PlainFillPlan["audit"][number]) => unknown) => p.audit.filter((a) => !a.anchor && f(a)).length;
  const rows: [string, string, string][] = [
    ["Off days filled", `${q.result.fills} of ${q.result.offBefore}`, `${p.stops.length} of ${q.result.offBefore}`],
    ["Avg Qloo fan heat of fills (same corridor read)", avg(q.stops.map((s) => s.affinity)), `${avg(pScored)}${outside ? ` · ${outside} outside corridor` : ""}${weak ? ` · ${weak} below floor` : ""}`],
    ["Fills inside an anchor's radius clause", "0 (enforced)", `${cnt((a) => a.radiusConflict)}`],
    ["Legs that double back", "0 (enforced)", `${cnt((a) => a.doublesBack)}`],
    ["Days over max drive (OSRM miles or hours)", "0 (enforced)", `${cnt((a) => a.overDrive)}`],
    ["Stops not on an off day", "0 (enforced)", `${cnt((a) => a.dateConflict)}`],
    ["Rooms / support acts that are real Qloo entities", `${q.grounding.grounded}/${q.grounding.referenced}`, `0/${p.stops.length} (generic names)`],
  ];
  return (
    <div className="card bg-panel overflow-hidden text-sm">
      <div className="grid grid-cols-[1.6fr_1fr_1.3fr] bg-black/30 text-xs uppercase tracking-wide">
        <div className="p-2.5 text-plain">Same anchors, two planners</div><div className="p-2.5 text-accent">Routed + Qloo</div><div className="p-2.5 text-plain">Plain AI{p.simulated ? " (simulated)" : ""}</div>
      </div>
      {rows.map(([k, a, b]) => (
        <div key={k} className="grid grid-cols-[1.6fr_1fr_1.3fr] border-t border-line"><div className="p-2.5 text-plain">{k}</div><div className="p-2.5 font-mono">{a}</div><div className="p-2.5 font-mono text-plain">{b}</div></div>
      ))}
    </div>
  );
}

// ---------- With Qloo / Without Qloo ranked lists (the primary comparison) ----------
/** Top-N gap cities per corridor, ordered by Qloo affinity or by the population/venues proxy. Same candidate set. */
export function RankedLists({ ranked, mode, picked, top = 5 }: { ranked: RankedGap[]; mode: RankMode; picked?: Set<string>; top?: number }) {
  return (
    <section className={`border rounded-xl p-4 grid gap-3 text-sm ${mode === "with" ? "bg-panel border-accent/50" : "bg-panel border-dashed border-line"}`} aria-label="Ranked gap cities">
      <div className="flex justify-between flex-wrap gap-2 items-baseline">
        <h3 className="font-semibold">{mode === "with" ? "Gap cities, ranked by Qloo affinity" : "Gap cities, ranked without Qloo"}</h3>
        <span className="text-xs text-plain">Same cities in both modes (hard filters only: Census market floor, radius clause, no backtracking, a mapped OSM venue, OSRM drive limits). Only the order changes.</span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {ranked.map((g) => {
          const list = mode === "with" ? g.withQloo : g.withoutQloo;
          return (
            <div key={g.from + g.to} className="grid gap-1.5 content-start">
              <div className="text-xs text-plain">{g.from} → {g.to} · {g.eligible} of {g.inCorridor} corridor cities pass the hard filters{g.note ? ` · ${g.note}` : ""}</div>
              <ol className="grid gap-1.5">
                {list.slice(0, top).map((c, i) => (
                  <li key={c.id} className="grid grid-cols-[22px_1fr] gap-x-1">
                    <span className="font-mono text-plain">{i + 1}.</span>
                    <span>
                      <span className="font-medium">{c.name}</span>{!c.name.endsWith(`, ${c.region}`) && <span className="text-plain">, {c.region}</span>}
                      {mode === "with" && picked?.has(c.name) && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent align-middle">on the route</span>}
                      {mode === "without" && <span className="ml-1.5 text-[11px] text-plain">pop {num(c.population)} · {c.venues} venues</span>}
                      <span className={`block text-[11px] font-mono ${mode === "with" ? "text-accent" : "text-plain"}`} data-score-line>{scoreLine(mode, c.affinity)}</span>
                    </span>
                  </li>
                ))}
              </ol>
              {list.length > top && <div className="text-[11px] text-plain">+{list.length - top} more pass the filters</div>}
            </div>
          );
        })}
      </div>
      {mode === "without" && <div className="text-xs text-plain">Without Qloo there is no fan signal, so Routed builds no schedule: a population-first list is all the hard filters and Census/OSM data can give. Switch to <b>With Qloo</b> for the routed calendar.</div>}
    </section>
  );
}
