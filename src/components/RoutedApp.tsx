"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { AgentEvent, CoheadPlan, FillPlan, PlainFillPlan } from "@/lib/agent/types";
import { streamPlan } from "@/lib/client/stream";
import AgentTrace from "./AgentTrace";
import { ErrorPanel, WarningList, errorOf } from "./ErrorPanel";
import ModeBanner, { ModePill, type Modes } from "./ModeBanner";
import MapView from "./MapView";
import FillForm, { DEMO_FILL, Spinner, demoCohead, demoFill, type FillFormState } from "./FillForm";
import ArtistInput from "./ArtistInput";
import CoheadView from "./CoheadView";
import { CandidateFilter, FillCalendar, FillCompare, FillStats, FillStopCard, FillSummary, PlainAudit, RankedLists, plainCalendar, useFillMap } from "./FillViews";
import type { RankMode } from "@/lib/route/rank";
import SourcesPanel from "./SourcesPanel";
import PromoterView from "./PromoterView";
import { CYAN, PLAIN } from "./palette";
import BenchmarkCard from "./BenchmarkCard";
import { PlanActions } from "./HoldDraft";

type Tab = "fill" | "cohead";
/** Two sides of the same system: the booking agent's routing tools, or the promoter's city-first view. */
type Role = "agent" | "promoter";
/** Secondary LLM baseline panel (the primary comparison is the deterministic With/Without Qloo toggle). */
type Baseline = "off" | "plain" | "compare";

const resultOf = <T,>(ev: AgentEvent[]) => ev.find((e) => e.type === "result")?.plan as T | undefined;

export default function RoutedApp({ initialModes }: { initialModes?: NonNullable<Modes> }) {
  const sp = useSearchParams();
  const [modes, setModes] = useState<Modes>(initialModes ?? null);
  const [role, setRoleState] = useState<Role>(sp.get("role") === "promoter" ? "promoter" : "agent");
  const setRole = useCallback((r: Role) => {
    setRoleState(r);
    const u = new URL(window.location.href);
    if (r === "promoter") u.searchParams.set("role", "promoter"); else u.searchParams.delete("role");
    window.history.replaceState(null, "", u);
  }, []);
  const [tab, setTab] = useState<Tab>(sp.get("tab") === "cohead" ? "cohead" : "fill");
  const [rank, setRank] = useState<RankMode>(() => (sp.get("qloo") === "0" ? "without" : "with"));
  const [baseline, setBaseline] = useState<Baseline>(() => { const v = sp.get("view"); return v === "plain" || v === "compare" ? v : "off"; });
  const [fill, setFill] = useState<FillFormState>(() => demoFill(initialModes?.qloo));
  const [co, setCo] = useState(() => demoCohead(initialModes?.qloo));
  const [qEv, setQEv] = useState<AgentEvent[]>([]);
  const [pEv, setPEv] = useState<AgentEvent[]>([]);
  const [cEv, setCEv] = useState<AgentEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [coTried, setCoTried] = useState(false);
  const [sources, setSources] = useState(() => sp.get("sources") === "1");
  const openSources = useCallback(() => { setSources(true); setTimeout(() => document.getElementById("sources")?.scrollIntoView({ behavior: "smooth" }), 0); }, []);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((j: { modes: NonNullable<Modes> }) => {
      setModes(j.modes);
      // Live Qloo has no fictional demo acts: swap in the live demo unless the user has typed already.
      if (j.modes.qloo !== "live") return;
      setFill((f) => (f === DEMO_FILL || !f.artist.trim() ? { ...f, artist: demoFill("live").artist } : f));
      setCo((c) => (c.artist === demoCohead("mock").artist && c.partner === demoCohead("mock").partner ? demoCohead("live") : c));
    }).catch(() => setModes({ qloo: "mock", llm: "mock" }));
  }, []);

  const runFill = useCallback(async (f: FillFormState) => {
    setBusy(true); setQEv([]); setPEv([]);
    const body = { task: "fill", artist: f.artist, anchors: f.anchors, maxDriveMi: f.maxDriveMi, minAffinity: f.minAffinity, rules: f.rules };
    await Promise.all([streamPlan({ ...body, mode: "qloo" }, (e) => setQEv((x) => [...x, e])), streamPlan({ ...body, mode: "plain" }, (e) => setPEv((x) => [...x, e]))]);
    setBusy(false);
  }, []);
  const runCo = useCallback(async (c: { artist: string; partner: string }) => {
    setBusy(true); setCEv([]);
    await streamPlan({ task: "cohead", artist: c.artist, partner: c.partner }, (e) => setCEv((x) => [...x, e]));
    setBusy(false);
  }, []);

  const [auto] = useState(() => sp.get("auto") === "1");
  const autoRan = useRef(false);
  useEffect(() => {
    if (!auto || !modes || autoRan.current) return; // wait for the mode, so ?auto=1 runs the right demo
    autoRan.current = true;
    const t = setTimeout(() => (tab === "cohead" ? runCo(demoCohead(modes.qloo)) : runFill(demoFill(modes.qloo))), 0);
    return () => clearTimeout(t);
  }, [auto, modes]); // eslint-disable-line react-hooks/exhaustive-deps -- run the ?auto=1 demo once, when the mode is known

  /** Promoter -> agent hand-off: the chosen act lands in Fill the gaps, anchors untouched. */
  const planFor = useCallback((artist: string) => {
    setFill((f) => ({ ...f, artist })); setTab("fill"); setQEv([]); setPEv([]); setRole("agent");
    setTimeout(() => document.getElementById("planner")?.scrollIntoView({ behavior: "smooth" }), 0);
  }, [setRole]);

  const q = resultOf<FillPlan>(qEv), p = resultOf<PlainFillPlan>(pEv), c = resultOf<CoheadPlan>(cEv);
  const qErr = errorOf(qEv), pErr = errorOf(pEv), cErr = errorOf(cEv);
  const qMap = useFillMap(q);
  const started = tab === "fill" ? qEv.length > 0 || busy : cEv.length > 0 || busy;

  return (
    <div className="flex flex-col min-h-screen">
      <ModeBanner modes={modes} />
      <nav className="sticky top-0 z-40 border-b border-line/80 bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/65">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
          <Link href="/" aria-label="Fanpoint home" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
            <img src="/fanpoint-logo.svg" alt="Fanpoint" width={112} height={26} className="h-[26px] w-auto" />
          </Link>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {role === "agent" && <a href="#how" className="btn btn-ghost btn-sm hidden md:inline-flex">How it works</a>}
            <button onClick={() => (sources ? setSources(false) : openSources())} aria-pressed={sources} className={`btn btn-ghost btn-sm hidden sm:inline-flex ${sources ? "!text-accent-text" : ""}`}>Sources</button>
            <ModePill modes={modes} />
            <a href={GITHUB} target="_blank" rel="noreferrer" aria-label="Fanpoint on GitHub" className="btn btn-ghost btn-sm !px-2"><GitHubIcon /></a>
          </div>
        </div>
      </nav>

      <header className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(124,58,237,0.18),transparent_70%)]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-6 sm:pb-8 grid gap-4">
          <a href="https://www.qloo.com/" target="_blank" rel="noreferrer" className="justify-self-start inline-flex items-center gap-2 rounded-full border border-line bg-panel/80 px-3 py-1 text-[11px] font-medium text-plain hover:text-foreground">
            <span className="size-1.5 rounded-full bg-accent" aria-hidden />Powered by Qloo Taste AI™
          </a>
          {role === "agent" ? (<>
          <h1 className="text-[34px] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.025em] max-w-3xl">Fill every off day <span className="text-accent">between your anchor dates.</span></h1>
          <p className="text-[15px] sm:text-lg text-plain max-w-2xl leading-relaxed"><b className="text-foreground font-semibold">Fanpoint is a decision tool for booking agents and promoters.</b> Indie artists don&apos;t book full tours. They book around the dates they land: a festival slot, a support date. Fanpoint fills the open days between confirmed shows with cities where the act&apos;s fans are, under real touring rules, and finds acts whose fans overlap to share the bill.</p>
          </>) : (<>
          <h1 className="text-[34px] leading-[1.08] sm:text-5xl font-semibold tracking-[-0.025em] max-w-3xl">Book the acts <span className="text-accent">your city already loves.</span></h1>
          <p className="text-[15px] sm:text-lg text-plain max-w-2xl leading-relaxed"><b className="text-foreground font-semibold">Fanpoint is a decision tool for booking agents and promoters.</b> Promoters get the other side: the acts their city&apos;s fans love most. Pick your city; get the artists whose fans Qloo ranks strongest there, then hand one to the routing desk.</p>
          </>)}
          <div role="tablist" aria-label="Your role" className="seg justify-self-start mt-1">
            {([["agent", "I'm an agent"], ["promoter", "I'm a promoter"]] as [Role, string][]).map(([r, l]) => (
              <button key={r} role="tab" aria-selected={role === r} onClick={() => setRole(r)} className="seg-accent">{l}</button>
            ))}
          </div>
        </div>
      </header>

      {role === "promoter" ? (
        <main className="pb-16 grid gap-5">
          {sources && <div className="max-w-7xl w-full mx-auto px-4 sm:px-6"><SourcesPanel onClose={() => setSources(false)} /></div>}
          <PromoterView onPlan={planFor} live={modes?.qloo === "live"} onSources={openSources} />
        </main>
      ) : (<>
      <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pb-5"><BenchmarkCard /></div>
      <section id="planner" aria-label="Planner" className="max-w-7xl w-full mx-auto px-4 sm:px-6 pb-6 scroll-mt-16">
        <div className="card">
          <div className="flex items-center justify-between gap-3 flex-wrap border-b border-line px-4 sm:px-5 py-3">
            <div role="tablist" aria-label="Tool" className="seg w-full sm:w-auto">
              {([["fill", "Fill the gaps"], ["cohead", "Co-headliner match"]] as [Tab, string][]).map(([t, l]) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{l}</button>
              ))}
            </div>
            <span className="text-xs text-plain">{tab === "fill" ? "Fixed dates in → gap cities + drive times out" : "Two acts in → complementary fan map out"}</span>
          </div>
          <div className="p-4 sm:p-5">
            {tab === "fill" ? <FillForm value={fill} onChange={setFill} onSubmit={() => runFill(fill)} busy={busy} onSources={openSources} mode={modes?.qloo} onReset={() => setFill(demoFill(modes?.qloo))} /> : (
              <form noValidate onSubmit={(e) => { e.preventDefault(); if (!co.artist.trim()) { setCoTried(true); return; } runCo(co); }} className="grid md:grid-cols-[1fr_1fr_auto] gap-4 items-start">
                <ArtistInput id="co-artist" label="Your act" value={co.artist} onChange={(v) => setCo({ ...co, artist: v })} error={coTried && !co.artist.trim() ? "Enter your act's name." : undefined} placeholder="Search Qloo artists" />
                <ArtistInput id="co-partner" label="Proposed co-headliner (optional)" value={co.partner} onChange={(v) => setCo({ ...co, partner: v })} hint="Leave empty and Fanpoint scans peer acts." placeholder="Search Qloo artists" />
                <div className="flex gap-2 md:pt-[22px]">
                  <button type="submit" disabled={busy} className="btn btn-primary px-6 py-[11px] w-full md:w-auto">{busy && <Spinner />}{busy ? "Comparing…" : "Match co-headliners"}</button>
                  <button type="button" disabled={busy} onClick={() => { setCoTried(false); setCo(demoCohead(modes?.qloo)); }} className="btn btn-ghost">Reset</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </section>

      <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 pb-16 grid gap-5">
        {sources && <SourcesPanel onClose={() => setSources(false)} />}
        {!started && <Landing tab={tab} live={modes?.qloo === "live"} onDemo={() => {
          if (tab === "fill") { const f = fill.artist.trim() ? fill : demoFill(modes?.qloo); setFill(f); void runFill(f); }
          else { const c = co.artist.trim() ? co : demoCohead(modes?.qloo); setCo(c); void runCo(c); }
        }} />}

        {started && tab === "fill" && (
          <>
            <div className={`flex justify-between items-center flex-wrap gap-3 ${q ? "card card-pad" : ""}`}>
              {q ? (rank === "with" ? <FillStats q={q} /> : <div className="text-sm text-plain max-w-xl">Without Qloo: the same filtered cities, ordered by Census population and OSM venues. No fan signal, so no schedule is built.</div>) : <div className="text-sm text-plain">{qErr ? "No routing." : <span className="sr-only">Agent is routing…</span>}</div>}
              <QlooToggle value={rank} onChange={setRank} />
            </div>
            {!q && !qErr && <Progress events={qEv} />}
            {qErr && <ErrorPanel error={qErr} context="Fanpoint + Qloo" onRetry={busy ? undefined : () => runFill(fill)} />}
            {q && <WarningList warnings={q.warnings} />}
            {q && <RankedLists ranked={q.ranked} mode={rank} picked={new Set(q.stops.map((x) => x.city))} />}
            {q && rank === "with" && <div className="grid gap-3"><FillSummary q={q} /><PlanActions q={q} /></div>}
            {rank === "with" && (
              <div className="grid lg:grid-cols-[1fr_370px] gap-5">
                <div className="grid gap-4 content-start min-w-0">
                  {q && <FillCalendar days={q.result.calendar} />}
                  <MapCard title="Route map" legend={<><Dot c="#ffffff" />Anchor <Dot c={CYAN} />Fill <span className="inline-block h-1.5 w-8 rounded-full bg-[linear-gradient(90deg,rgb(30,41,59),rgb(6,182,212),rgb(124,58,237),rgb(221,214,254))]" aria-hidden />Qloo fan heat</>}>
                    <MapView rings={qMap?.rings} cells={qMap?.cells} paths={qMap?.paths} markers={qMap?.markers} fit={qMap?.fit} height={420} />
                  </MapCard>
                  {q && <CandidateFilter gaps={q.result.gaps} maxDriveMi={q.params.maxDriveMi} />}
                  <div className="grid md:grid-cols-2 gap-4">{q?.stops.map((s) => <FillStopCard key={s.date} s={s} q={q} />)}</div>
                </div>
                <AgentTrace events={qEv} title="Agent trace · Qloo calls" />
              </div>
            )}
            {rank === "without" && q && (
              <MapView rings={qMap?.rings} fit={qMap?.fit} height={360}
                markers={[...q.anchors.map((a) => ({ lat: a.lat, lon: a.lon, color: "#ffffff", radius: 8, label: `★ ${a.city}`, dir: "left" as const })),
                  ...q.ranked.flatMap((g) => g.withoutQloo.slice(0, 5).map((c, i) => ({ lat: c.lat, lon: c.lon, color: PLAIN, label: `${i + 1}. ${c.name}` })))]} />
            )}

            <section className="grid gap-3 border-t border-line pt-5 mt-2">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <div className="text-sm"><b>Secondary baseline: an LLM with no tools.</b> <span className="text-plain">The same anchors given to a plain LLM (no Qloo, no rules), audited in code.</span></div>
                <div role="tablist" aria-label="Plain AI baseline" className="seg">
                  {([["off", "Hide"], ["plain", "Plain AI"], ["compare", "Compare"]] as [Baseline, string][]).map(([v, l]) => (
                    <button key={v} role="tab" aria-selected={baseline === v} onClick={() => setBaseline(v)}>{l}</button>
                  ))}
                </div>
              </div>
              {baseline !== "off" && pErr && <ErrorPanel error={pErr} context="Plain AI baseline" onRetry={busy ? undefined : () => runFill(fill)} />}
              {baseline === "plain" && p && (() => {
                const pc = plainCalendar(p, q);
                const pts = pc.days.filter((d) => d.kind !== "off" && d.lat !== undefined).map((d) => ({ lat: d.lat!, lon: d.lon! }));
                const markers = pc.days.filter((d) => d.kind !== "off" && d.lat !== undefined).map((d) => ({ lat: d.lat!, lon: d.lon!, color: d.kind === "anchor" ? "#fff" : pc.flagged.has(d.date) ? "#ef4444" : PLAIN, label: d.kind === "anchor" ? `★ ${d.city}` : d.city, dir: (d.kind === "anchor" ? "left" : "right") as "left" | "right" }));
                return (
                  <div className="grid gap-4">
                    <div className="text-sm text-plain">{p.simulated && <span className="mr-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">SIMULATED</span>}Baseline for comparison only: the same anchors given to an LLM with no tools, no Qloo and no rules, answering from general knowledge. Its picks are then audited in code with OSRM road data and Fanpoint&apos;s touring rules; red = breaks a rule.</div>
                    <FillCalendar days={pc.days} plain flagged={pc.flagged} />
                    <div className="grid lg:grid-cols-2 gap-4"><MapView paths={[{ pts, color: PLAIN, dash: "6 6" }]} markers={markers} fit={qMap?.fit} height={380} /><PlainAudit p={p} q={q} /></div>
                  </div>
                );
              })()}
              {baseline === "compare" && (
                <div className="grid gap-4">
                  <FillCompare q={q} p={p} />
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="grid gap-2"><h3 className="text-sm font-semibold text-accent-text">Fanpoint + Qloo</h3>{q && <FillCalendar days={q.result.calendar} />}</div>
                    <div className="grid gap-2"><h3 className="text-sm font-semibold text-plain">Plain AI</h3>{p && (() => { const pc = plainCalendar(p, q); return <FillCalendar days={pc.days} plain flagged={pc.flagged} />; })()}</div>
                  </div>
                </div>
              )}
            </section>
          </>
        )}

        {started && tab === "cohead" && (
          <div className="grid gap-5">
            {cErr && <ErrorPanel error={cErr} onRetry={busy ? undefined : () => runCo(co)} />}
            {c && <WarningList warnings={c.warnings} />}
            {(c || busy) && <div className="flex justify-end"><QlooToggle value={rank} onChange={setRank} /></div>}
            {c ? <CoheadView plan={c} mode={rank} /> : !cErr && <Progress events={cEv} label="Comparing fan geography…" />}
            <AgentTrace events={cEv} title="Agent trace · Qloo calls" />
          </div>
        )}
      </main>
      </>)}
      <footer className="border-t border-line bg-panel/40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 grid gap-6 md:grid-cols-[1fr_2fr] text-xs text-plain">
          <div className="grid gap-2 content-start">
            {/* eslint-disable-next-line @next/next/no-img-element -- static SVG logo */}
            <img src="/fanpoint-logo.svg" alt="Fanpoint" width={95} height={22} className="h-[22px] w-auto justify-self-start" />
            <span>Tour routing from taste data. Built for the Qloo Agentic Hackathon.</span>
            <span className="flex gap-3"><a className="underline underline-offset-2 hover:text-foreground" href={GITHUB} target="_blank" rel="noreferrer">GitHub</a><button onClick={openSources} className="underline underline-offset-2 hover:text-foreground">Sources &amp; methodology</button></span>
          </div>
          <div className="grid gap-1.5 leading-relaxed">
            <div className="eyebrow">Data sources</div>
            <div>Taste data from the Qloo Taste AI™ API. Road distances and times: <a className="underline" href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a>, precomputed. Map data, city centres and venue counts © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL) · <a className="underline" href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">fix the map</a>. Population and metro areas: U.S. Census Bureau.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}

const GITHUB = "https://github.com/Mellowoah/Fanpoint";
function GitHubIcon() {
  return <svg aria-hidden width="18" height="18" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>;
}
const Dot = ({ c }: { c: string }) => <span aria-hidden className="inline-block size-2.5 rounded-full ring-2 ring-background ml-2 first:ml-0" style={{ background: c }} />;

/** The map, framed as a card: title and legend on top, so it reads as a deliberate panel rather than a bare widget. */
function MapCard({ title, legend, children }: { title: string; legend?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-line">
        <h3 className="text-sm font-semibold">{title}</h3>
        {legend && <div className="flex items-center gap-1.5 text-[11px] text-plain">{legend}</div>}
      </div>
      <div className="p-1.5">{children}</div>
    </div>
  );
}

/** Loading state while the agent streams: each step it reports, with a progress bar. */
function Progress({ events, label = "Agent is routing…" }: { events: AgentEvent[]; label?: string }) {
  const steps = new Map<string, Extract<AgentEvent, { type: "step" }>>();
  for (const e of events) if (e.type === "step") steps.set(e.id, e);
  const list = [...steps.values()];
  const done = list.filter((s) => s.status === "done").length;
  const calls = events.reduce((n, e) => n + (e.type === "tool" ? e.qlooCalls.length : 0), 0);
  const pct = list.length ? Math.max(8, Math.round((done / (list.length + 1)) * 100)) : 4;
  return (
    <div className="card card-pad grid gap-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold"><Spinner className="text-accent-text" />{label}</span>
        <span className="text-xs text-plain font-mono">{done}/{Math.max(list.length, 1)} steps{calls ? ` · ${calls} Qloo calls` : ""}</span>
      </div>
      <div className="h-1.5 rounded-full bg-background overflow-hidden" aria-hidden><div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} /></div>
      <ol className="grid gap-2 text-sm">
        {list.length === 0 && <li className="text-plain">Connecting to the agent…</li>}
        {list.map((s) => (
          <li key={s.id} className="flex gap-2.5 items-start">
            <span aria-hidden className={`mt-0.5 size-4 shrink-0 rounded-full grid place-items-center text-[10px] ${s.status === "done" ? "bg-emerald-500/20 text-emerald-300" : s.status === "error" ? "bg-red-500/20 text-red-300" : "bg-accent/20 text-accent-text animate-pulse"}`}>{s.status === "done" ? "✓" : s.status === "error" ? "✗" : "•"}</span>
            <span className={s.status === "done" ? "text-plain" : ""}>{s.label}{s.detail && <span className="text-plain">: {s.detail}</span>}</span>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-3 gap-2" aria-hidden><div className="skeleton h-16" /><div className="skeleton h-16" /><div className="skeleton h-16" /></div>
    </div>
  );
}

/** The primary comparison: same hard-filtered candidates, ranked with Qloo affinity or without it. Default With Qloo. */
function QlooToggle({ value, onChange }: { value: RankMode; onChange: (m: RankMode) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow hidden sm:inline">Ranking</span>
      <div role="tablist" aria-label="Ranking signal" className="seg">
        {([["with", "With Qloo"], ["without", "Without Qloo"]] as [RankMode, string][]).map(([v, l]) => (
          <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)} className={v === "with" ? "seg-accent" : ""}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function Landing({ tab, live, onDemo }: { tab: Tab; live: boolean; onDemo: () => void }) {
  const f = demoFill(live ? "live" : "mock"), c = demoCohead(live ? "live" : "mock");
  const steps = [
    ["Pin the anchors", "Enter the shows that are already confirmed: festival slots, support dates, a hometown show."],
    ["Qloo reads the corridor", "Fanpoint reads the act's Qloo fan heatmap along each drive and drops cities that break touring rules: radius clauses, backtracking, road miles and hours per day."],
    ["Book with receipts", "Off days fill with the strongest markets left. Every number links to its source; the LLM only explains."],
  ];
  return (
    <div className="grid gap-5">
      <MapCard title={tab === "fill" ? "Your route will appear here" : "Your fan map will appear here"} legend={<span>{live ? "Real acts, live Qloo data" : "Fictional demo acts (mock mode)"}</span>}>
        <div className="relative">
          <MapView height={300} />
          <div className="absolute inset-0 grid place-items-center p-4 pointer-events-none">
            <div className="pointer-events-auto rounded-2xl border border-line bg-panel/90 backdrop-blur px-5 py-4 text-center grid gap-2.5 shadow-2xl shadow-black/50 max-w-sm">
              <div className="text-sm font-semibold">{tab === "fill" ? "The demo is prefilled" : "The demo pair is prefilled"}</div>
              <div className="text-xs text-plain">{tab === "fill" ? `${f.artist} · New York → Durham → Atlanta` : `${c.artist} × ${c.partner}`}</div>
              <button onClick={onDemo} className="btn btn-primary">{tab === "fill" ? `Route ${f.artist}'s 3 anchors` : `Match ${c.artist} with co-headliners`}</button>
            </div>
          </div>
        </div>
      </MapCard>
      <section id="how" aria-labelledby="how-title" className="grid gap-3 pt-2">
        <h2 id="how-title" className="eyebrow">How it works</h2>
        <ol className="grid md:grid-cols-3 gap-3">
          {steps.map(([t, d], i) => (
            <li key={t} className="card card-pad grid gap-1.5 content-start">
              <span className="size-7 rounded-lg bg-accent/15 text-accent-text grid place-items-center text-xs font-semibold font-mono">{i + 1}</span>
              <div className="font-semibold mt-1">{t}</div>
              <div className="text-sm text-plain leading-relaxed">{d}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
