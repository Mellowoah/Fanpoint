"use client";
import { useMemo } from "react";
import type { Entity } from "@/lib/qloo/types";
import type { FillPlan, FillStop, PlainFillPlan } from "@/lib/agent/types";
import type { CandidateStatus, Day, GapPlan } from "@/lib/route/fill";
import { censusUrl, findMarket, MARKETS_META, marketById, osmUrl } from "@/lib/data/markets";
import { RULES } from "@/lib/touring/rules";
import { KindBadge } from "./SourcesPanel";
import type { RankMode, RankedGap } from "@/lib/route/rank";
import { scoreLine } from "@/lib/route/score-line";
import type { Marker } from "./MapView";
import WhyPopover from "./WhyPopover";
import { HoldDraftButton } from "./HoldDraft";
import { CYAN } from "./palette";
import ScoreLineText from "./ScoreLineText";
import { FanHoods, RoomCard } from "./QlooPlus";
import { FanScore } from "./FanScore";
import { AlsoLikePanel } from "./AlsoLike";
import { AdPackButton } from "./AdLaunch";

const pct = (a?: number) => (a === undefined ? "–" : `${Math.round(a * 100)}`);
const md = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** All Qloo corridor reads from the run, by city name (used to score ANY city, including plain-AI picks). */
export function corridorHeat(q?: FillPlan) {
  const m = new Map<string, { affinity: number; rank: number; corridor: string }>();
  for (const c of q?.corridors ?? []) for (const x of c.candidates) if (!m.has(x.name)) m.set(x.name, { affinity: x.affinity, rank: x.rank, corridor: `${c.from}→${c.to}` });
  return m;
}

// ---------- Calendar (signature strip) ----------
export function FillCalendar({ days, plain, flagged, legend }: { days: Day[]; plain?: boolean; flagged?: Set<string>; legend?: boolean }) {
  return (
    <div className="grid gap-1.5">
    {legend && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-plain" data-calendar-legend>
      <span className="text-foreground font-medium">One box per date:</span>
      <span className="inline-flex items-center gap-1"><span aria-hidden className="size-3 rounded-sm border border-white/60 bg-white/10" />already booked</span>
      <span className="inline-flex items-center gap-1"><span aria-hidden className="size-3 rounded-sm border border-accent/70 bg-accent/15" />{plain ? "date filled" : "date we filled"} (fans = fan strength out of 100)</span>
      <span className="inline-flex items-center gap-1"><span aria-hidden className="size-3 rounded-sm border border-line bg-[repeating-linear-gradient(135deg,var(--panel),var(--panel)_3px,var(--background)_3px,var(--background)_6px)]" />still open</span>
      {flagged && <span className="inline-flex items-center gap-1"><span aria-hidden className="size-3 rounded-sm border border-red-500" />breaks a touring limit</span>}
    </div>}
    <div className="overflow-x-auto">
      <div className="grid grid-flow-col auto-cols-[minmax(80px,1fr)] gap-1 min-w-max">
        {days.map((d) => {
          const bad = flagged?.has(d.date);
          const cls = d.kind === "anchor" ? "bg-white/10 border-white/60" : d.kind === "fill" ? (plain ? `bg-plain/10 ${bad ? "border-red-500" : "border-plain/50"}` : "bg-accent/15 border-accent/70") : "border-line bg-[repeating-linear-gradient(135deg,var(--panel),var(--panel)_6px,var(--background)_6px,var(--background)_12px)]";
          return (
            <div key={d.date} className={`border rounded-md p-1.5 text-xs leading-tight h-[100px] flex flex-col ${cls}`}>
              <div className="flex justify-between text-plain"><span>{d.dow}</span><span>{md(d.date)}</span></div>
              {d.kind === "off" ? (d.holiday
                ? <div className="m-auto text-center leading-tight" title={`${d.holiday}: kept open by the holidays rule (you can change it in Touring rules)`}><div className="text-plain">open</div><div className="text-xs text-amber-300/90">holiday</div><div className="text-xs text-plain truncate max-w-[70px]">{d.holiday}</div></div>
                : <div className="m-auto text-plain" title="No show booked on this date">open</div>) : (
                <>
                  <div className="font-semibold mt-1 truncate" title={d.city}>{d.city}</div>
                  {d.kind === "anchor" ? <div className="text-xs text-plain truncate">{d.label ?? "anchor"}</div>
                    : d.affinity !== undefined ? <div className={plain ? "text-plain" : "text-accent-text"} title="Fan strength: how concentrated this act's fans are here, 0–100 (Qloo)">fans <b className="font-mono">{pct(d.affinity)}</b></div> : <div className="text-xs text-plain">no fan data</div>}
                  {d.driveMi !== undefined && <div className={`mt-auto text-xs ${bad ? "text-red-400" : "text-plain"}`}><span title="Drive from the previous show">{d.driveMi} mi{d.driveHours !== undefined ? ` · ${d.driveHours} h` : ""}{d.driveDays && d.driveDays > 1 ? ` / ${d.driveDays} days` : ""}</span></div>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
    </div>
  );
}

export function FillStats({ q }: { q: FillPlan }) {
  const r = q.result;
  const items: [string, string][] = [
    ["Open dates we filled", `${r.fills} of ${r.offBefore}`],
    ["Dates still open", `${r.offAfter}`],
    ["Longest day of driving", `${r.maxDayDrive} mi · ${r.maxDayHours} h`],
    ["Most shows before a day off", `${r.longestRun}`],
  ];
  return (
    <div className="grid gap-2" data-fill-stats>
      <div className="grid grid-cols-2 md:grid-cols-[auto_auto_auto_auto_1fr] gap-x-6 gap-y-2 text-sm items-end">
        {items.map(([k, v], i) => <div key={k}><div className="text-xs text-plain">{k}</div><div className={i === 0 ? "text-xl font-bold text-accent-text font-mono" : "font-mono text-base"}>{v}</div></div>)}
        <div className="col-span-2 md:col-span-1 flex items-center gap-1.5 text-xs text-plain">
          <span>Shows that broke touring limits: <b className="font-mono text-foreground">0</b></span>
          <WhyPopover label="touring limits used" title="Limits">
            Every filled date respects: at most {q.params.maxDriveMi} road miles and {q.params.maxDriveHours} hours of driving a day; at most {q.params.maxConsecutiveShows} shows before a day off; no doubling back toward a city already played; no show within {q.params.radiusMi} miles of a booked show (the &ldquo;radius clause&rdquo; in most show contracts){q.params.holidaysOff ? "; major travel holidays kept open" : ""}. Road miles and hours come from OSRM (car route on OpenStreetMap roads, no stops).
          </WhyPopover>
        </div>
      </div>
    </div>
  );
}

// ---------- The filter that removes unrealistic cities ----------
/** Plain-English names for why a city was or wasn't booked (the status values come from fill.ts). */
export const STATUS_LABEL: Record<CandidateStatus, string> = {
  picked: "booked", "didn't fit schedule": "no open date left for it", "below heat floor": "too few fans",
  "radius clause": "too close to a booked show", "off route / backtrack": "off the route (would double back)", "used elsewhere": "already booked on another date",
  "no road route": "no road route", "no mapped venue": "no music venue nearby",
};
const STATUS_STYLE: Record<string, string> = {
  picked: "text-accent-text", "didn't fit schedule": "text-plain", "below heat floor": "text-plain line-through",
  "radius clause": "text-red-300 line-through", "off route / backtrack": "text-red-300 line-through", "used elsewhere": "text-plain line-through",
  "no road route": "text-red-300 line-through", "no mapped venue": "text-red-300 line-through",
};
export function CandidateFilter({ gaps, maxDriveMi }: { gaps: GapPlan[]; maxDriveMi: number }) {
  return (
    <div className="card bg-panel p-4 grid gap-3 text-sm">
      <div className="flex justify-between flex-wrap gap-2">
        <h3 className="font-semibold">Every city we considered, and why it was or wasn&apos;t booked</h3>
        <span className="flex items-center gap-1.5 text-xs text-plain">Number = fan strength (0–100). Crossed out = ruled out.
          <WhyPopover label="how cities were filtered" title="How">Cities along each drive are ranked by Qloo fan strength, then checked in code: not too close to a booked show (radius clause), no doubling back, a real music venue nearby (OpenStreetMap), enough fans, and at most {maxDriveMi} road miles of driving a day (OSRM).</WhyPopover>
        </span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {gaps.map((g) => (
          <div key={g.from + g.to} className="grid gap-1">
            <div className="text-xs text-plain">{g.from} → {g.to}: {g.directMi} road mi ({g.directHours} h) direct · {g.offDays} open dates · {g.considered.length} cities checked</div>
            <div className="grid grid-cols-[1fr_44px_1.3fr] gap-x-2 text-xs">
              {g.considered.slice(0, 12).map((c) => (
                <div key={c.name} className="contents">
                  <span className={STATUS_STYLE[c.status]}>{c.name}</span>
                  <span className="font-mono text-right">{pct(c.affinity)}</span>
                  <span className={c.status === "picked" ? "text-accent-text" : c.status === "didn't fit schedule" ? "text-plain" : "text-red-300"}>{STATUS_LABEL[c.status]}{c.detail ? ` (${c.detail})` : ""}</span>
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
      ? { lat: d.lat!, lon: d.lon!, color: "#ffffff", radius: 8, label: `★ ${d.city} · ${md(d.date)}`, short: "★", dir: "left" as const, priority: 1 }
      : { lat: d.lat!, lon: d.lon!, color: CYAN, label: `${++n}. ${d.city} · ${pct(d.affinity)}`, short: `${n}`, tooltip: `${n}. ${d.city}: fan strength ${pct(d.affinity)} of 100` });
    return { cells, rings, paths: [{ pts: seq, color: CYAN, dash: "6 6" }], markers, fit: rings.flat() };
  }, [q]);
}

// ---------- Stop card ----------
function Chip({ e }: { e: Entity }) {
  const cap = e.place?.capacity;
  return <span title={cap ? `Holds ${cap.toLocaleString("en-US")} people, as stated by Qloo: "${e.place?.capacityQuote}"` : `Number = how strongly these fans overlap with the headliner's, 0–100 (Qloo)`} className="inline-flex items-center gap-1 bg-black/30 border border-line rounded-full px-2 py-0.5 text-xs">{e.name}{cap ? <span className="text-plain shrink-0">· holds {cap.toLocaleString("en-US")}</span> : null}{e.affinity !== undefined && <span className="text-accent-text font-mono shrink-0" title="Fan overlap with the headliner, 0–100 (Qloo)">{pct(e.affinity)}</span>}</span>;
}
const num = (n: number) => n.toLocaleString("en-US");
const Src = ({ children, href }: { children: React.ReactNode; href?: string }) => href
  ? <a href={href} target="_blank" rel="noreferrer" className="text-xs text-plain underline underline-offset-2 hover:text-accent-text">{children}</a>
  : <span className="text-xs text-plain">{children}</span>;

/** The facts behind one recommendation, each with its source. */
function WhyFacts({ s }: { s: FillStop }) {
  const m = marketById(s.cityId) ?? findMarket(s.city);
  const rows: { k: string; v: React.ReactNode; src: React.ReactNode }[] = [
    { k: "Fans", v: <>fan strength <b className="text-accent-text">{pct(s.affinity)}</b> of 100{s.rankInCorridor ? <> · #{s.rankInCorridor} of {s.corridorSize} cities on this drive</> : null}</>, src: <Src href="https://docs.qloo.com/">Qloo heatmap</Src> },
    { k: "Drive", v: <>{s.driveMi} mi · {s.driveHours ?? "–"} h from {s.prevCity}{s.driveDays > 1 ? ` (${s.driveDays} days)` : ""}</>, src: <Src href="https://project-osrm.org/">OSRM · © OSM</Src> },
    { k: "Night", v: <>{s.dow}: busy-night score {s.dowWeight} of 1{s.run ? ` · show ${s.run} since the last day off` : ""}</>, src: <KindBadge kind={RULES.dowWeights.kind} /> },
  ];
  if (m) {
    rows.push({ k: "Population", v: <>{num(m.population)} city · {num(m.metro.population)} metro <span className="text-plain">({m.metro.title})</span></>, src: <Src href={censusUrl(m)}>Census V2025</Src> });
    rows.push({ k: "Venues", v: <>{m.venues.total} music venues and theatres within {MARKETS_META.venueRadiusMi} mi <span className="text-plain">({m.venues.theatre} theatres, {m.venues.nightclub} clubs, {m.venues.music_venue + m.venues.live_music} music)</span></>, src: <Src href={osmUrl(m)}>OpenStreetMap</Src> });
  }
  return (
    <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
      {rows.map(({ k, v, src }) => <div key={k} className="contents"><dt className="text-plain">{k}</dt><dd className="min-w-0 break-words">{v}</dd><dd className="col-start-2 -mt-0.5 mb-1">{src}</dd></div>)}
    </dl>
  );
}

export function FillStopCard({ s, q }: { s: FillStop; q: FillPlan }) {
  return (
    <article className="card bg-panel p-4 grid gap-2.5 min-w-0 [&>*]:min-w-0">
      <header className="flex justify-between gap-2">
        <div className="min-w-0 break-words">
          <div className="text-xs text-plain">{s.dow} {md(s.date)} · {s.driveMi} road mi / {s.driveHours ?? "–"} h from {s.prevCity}{s.driveDays > 1 ? ` over ${s.driveDays} days` : ""}</div>
          <h4 className="text-lg font-semibold">{s.city}{s.region && !s.city.endsWith(`, ${s.region}`) && <span className="text-plain font-normal">, {s.region}</span>}</h4>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-accent-text font-mono">{pct(s.affinity)}</div>
          <div className="text-xs text-plain">fan strength / 100</div>
        </div>
      </header>
      <div className="text-sm flex items-center gap-1.5 flex-wrap" data-why-stop>
        <span className="text-plain">{s.rankInCorridor === 1 ? "The strongest fan city on this drive" : s.rankInCorridor ? `#${s.rankInCorridor} fan city on this drive` : "Strong fan city"}, within the drive limits.</span>
        <WhyPopover label={`why ${s.city}`} title="Why this stop" wide><WhyFacts s={s} /><div className="mt-2 pt-2 border-t border-line font-mono text-xs text-accent-text" data-score-line><ScoreLineText text={scoreLine("with", s.affinity)} /></div></WhyPopover>
      </div>
      {s.aiNote && <div className="text-sm leading-snug flex items-center gap-1.5"><span className="text-xs px-1.5 py-0.5 rounded bg-white/5 border border-line text-plain" title="Written by the AI; every number in it was checked against the data">AI note</span><WhyPopover label={`AI note for ${s.city}`} title="Read">{s.aiNote}</WhyPopover></div>}
      {q.support && <div className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-plain w-20">Opening act</span><Chip e={q.support.entity} /><Src>same act every night</Src></div>}
      {s.support.length > 0 && <div className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-plain w-20">{q.support ? "Local option" : "Opening act"}</span>{s.support.map((e) => <Chip key={e.id} e={e} />)}<Src>{q.support ? "best local opener here" : "best Qloo match"}</Src></div>}
      {s.venues[0] ? <RoomCard v={s.venues[0]} note={s.room} stopCity={s.city} /> : <div className="text-xs text-plain">No Qloo show room matched near {s.city}.</div>}
      {s.venues.length > 1 && <div className="flex flex-wrap items-center gap-1.5"><span className="text-xs text-plain w-20">Next room</span>{s.venues.slice(1, 2).map((e) => <Chip key={e.id} e={e} />)}<Src>{s.venues.length > 2 ? `Qloo's #2 match · all ${s.venues.length} in the CSV export` : "Qloo's #2 match"}</Src></div>}
      <FanHoods hoods={s.neighborhoods} city={s.city} />
      <AlsoLikePanel s={s} artist={q.artist.name} status={q.crossDomain?.status} />
      <HoldDraftButton q={q} s={s} />
      <AdPackButton q={q} s={s} />
    </article>
  );
}

/** Deterministic summary plus the model's (number-checked) version, clearly labelled. */
export function FillSummary({ q }: { q: FillPlan }) {
  return (
    <div className="grid gap-1 text-sm">
      <p>{q.summary}</p>
      {q.aiSummary && <div className="text-plain flex items-center gap-1.5"><span className="text-xs px-1.5 py-0.5 rounded bg-white/5 border border-line">AI summary</span><WhyPopover label="AI summary of the route" title="Read">{q.aiSummary} <span className="text-plain">(Written by the AI; every number in it was checked against the data.)</span></WhyPopover></div>}
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
      <div className="grid grid-cols-[90px_1.2fr_1.5fr_90px_2fr] bg-black/30 text-xs uppercase tracking-wide text-plain">
        <div className="p-2">Date</div><div className="p-2">City</div><div className="p-2">Venue it suggested</div><div className="p-2">Fan strength</div><div className="p-2">Touring-limit check</div>
      </div>
      {p.stops.map((s) => {
        const a = p.audit.find((x) => x.date === s.date && x.city === s.city);
        const h = heat.get(s.city);
        const flags = [a?.dateConflict, a?.radiusConflict && `too close to the ${a.radiusConflict} show`, a?.doublesBack && "doubles back", a?.overDrive && `${a.perDay} mi of driving a day${a.driveHours !== undefined ? ` (${a.driveHours} h)` : ""}`, a?.noRoute && "no road route", !a?.mapped && "unknown city"]
          .filter((f): f is string => typeof f === "string" && f.length > 0);
        return (
          <div key={s.date + s.city} className="grid grid-cols-[90px_1.2fr_1.5fr_90px_2fr] border-t border-line">
            <div className="p-2 text-plain">{md(s.date)}</div><div className="p-2">{s.city}</div>
            <div className="p-2 text-plain italic">{s.venue} <span className="not-italic text-xs text-red-300">· not a verified venue</span></div>
            <div className="p-2 font-mono">{h ? pct(h.affinity) : <span className="text-plain text-xs">off the route</span>}</div>
            <div className="p-2 text-xs">{flags.length ? <span className="text-red-400">{flags.join(" · ")}</span> : <span className="text-plain">within the drive limits</span>}</div>
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
  const rows: [string, string, string, boolean?][] = [
    ["Open dates filled", `${q.result.fills} of ${q.result.offBefore}`, `${p.stops.length} of ${q.result.offBefore}`],
    ["Average fan strength of the new cities (0–100)", avg(q.stops.map((s) => s.affinity)), `${avg(pScored)}${outside ? ` · ${outside} off the route` : ""}${weak ? ` · ${weak} with too few fans` : ""}`],
    ["Shows too close to a booked show (radius clause)", "0 (enforced)", `${cnt((a) => a.radiusConflict)}`, cnt((a) => a.radiusConflict) > 0],
    ["Drives that double back", "0 (enforced)", `${cnt((a) => a.doublesBack)}`, cnt((a) => a.doublesBack) > 0],
    ["Days with too much driving", "0 (enforced)", `${cnt((a) => a.overDrive)}`, cnt((a) => a.overDrive) > 0],
    ["Most shows before a day off", `${q.result.longestRun} (limit ${q.params.maxConsecutiveShows})`, p.longestRun !== undefined ? `${p.longestRun}` : "–", (p.longestRun ?? 0) > (q.params.maxConsecutiveShows ?? Infinity)],
    ["Shows on a date that was already booked", "0 (enforced)", `${cnt((a) => a.dateConflict)}`, cnt((a) => a.dateConflict) > 0],
    ["Rooms and opening acts that really exist (checked in Qloo)", `${q.grounding.grounded} of ${q.grounding.referenced}`, `0 of ${p.stops.length} (generic names)`],
  ];
  return (
    <div className="card bg-panel overflow-hidden text-sm">
      <div className="grid grid-cols-[1.6fr_1fr_1.3fr] bg-black/30 text-xs uppercase tracking-wide">
        <div className="p-2.5 text-plain">Same booked shows, two planners</div><div className="p-2.5 text-accent-text">Fanpoint + Qloo</div><div className="p-2.5 text-plain">Plain AI chatbot{p.simulated ? " (simulated)" : ""}</div>
      </div>
      {rows.map(([k, a, b, bad]) => (
        <div key={k} className="grid grid-cols-[1.6fr_1fr_1.3fr] border-t border-line"><div className="p-2.5 text-plain">{k}</div><div className="p-2.5 font-mono">{a}</div><div className={`p-2.5 font-mono ${bad ? "text-red-400 font-semibold" : "text-plain"}`}>{b}</div></div>
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
        <h3 className="font-semibold">{mode === "with" ? "Best cities for the open dates, ranked by fan strength" : "Best cities for the open dates, ranked without fan data"}</h3>
        <span className="flex items-center gap-1.5 text-xs text-plain">Same cities with or without Qloo; only the order changes.
          <WhyPopover label="which cities are listed" title="How">Both lists hold the same cities: those big enough (Census), not too close to a booked show (radius clause), on the way without doubling back, with a real music venue (OpenStreetMap) and within the drive limits (OSRM). With Qloo they are ordered by fan strength; without it, by population and venue count.</WhyPopover>
        </span>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        {ranked.map((g) => {
          const list = mode === "with" ? g.withQloo : g.withoutQloo;
          return (
            <div key={g.from + g.to} className="grid gap-1.5 content-start">
              <div className="text-xs text-plain">{g.from} → {g.to}: {g.eligible} of {g.inCorridor} cities on this drive pass the touring limits{g.note ? ` · ${g.note}` : ""}</div>
              <ol className="grid gap-1.5">
                {list.slice(0, top).map((c, i) => (
                  <li key={c.id} className="grid grid-cols-[22px_1fr] gap-x-1">
                    <span className="font-mono text-plain">{i + 1}.</span>
                    <span>
                      <span className="font-medium">{c.name}</span>{!c.name.endsWith(`, ${c.region}`) && <span className="text-plain">, {c.region}</span>}
                      {mode === "with" && picked?.has(c.name) && <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent-text align-middle">booked on this tour</span>}
                      {mode === "without" && <span className="ml-1.5 text-xs text-plain">{num(c.population)} people · {c.venues} venues</span>}
                      <FanScore mode={mode} affinity={c.affinity} />
                    </span>
                  </li>
                ))}
              </ol>
              {list.length > top && <div className="text-xs text-plain">+{list.length - top} more cities pass the touring limits</div>}
            </div>
          );
        })}
      </div>
      {mode === "without" && <div className="text-xs text-plain">Without Qloo there is no fan data, so Fanpoint can&apos;t build a schedule: biggest cities first is the best it can do. Switch to <b>With Qloo</b> for the routed calendar.</div>}
    </section>
  );
}
