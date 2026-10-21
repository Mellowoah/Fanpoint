"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { AgentEvent, CoheadPlan, FillPlan, PlainFillPlan } from "@/lib/agent/types";
import { streamPlan } from "@/lib/client/stream";
import AgentTrace from "./AgentTrace";
import { ErrorPanel, WarningList, errorOf } from "./ErrorPanel";
import ModeBanner, { type Modes } from "./ModeBanner";
import MapView from "./MapView";
import FillForm, { DEMO_FILL, demoCohead, demoFill, type FillFormState } from "./FillForm";
import CoheadView from "./CoheadView";
import { CandidateFilter, FillCalendar, FillCompare, FillStats, FillStopCard, FillSummary, PlainAudit, RankedLists, plainCalendar, useFillMap } from "./FillViews";
import type { RankMode } from "@/lib/route/rank";
import SourcesPanel from "./SourcesPanel";

type Tab = "fill" | "cohead";
/** Secondary LLM baseline panel (the primary comparison is the deterministic With/Without Qloo toggle). */
type Baseline = "off" | "plain" | "compare";

const resultOf = <T,>(ev: AgentEvent[]) => ev.find((e) => e.type === "result")?.plan as T | undefined;

export default function RoutedApp() {
  const sp = useSearchParams();
  const [modes, setModes] = useState<Modes>(null);
  const [tab, setTab] = useState<Tab>(sp.get("tab") === "cohead" ? "cohead" : "fill");
  const [rank, setRank] = useState<RankMode>(() => (sp.get("qloo") === "0" ? "without" : "with"));
  const [baseline, setBaseline] = useState<Baseline>(() => { const v = sp.get("view"); return v === "plain" || v === "compare" ? v : "off"; });
  const [fill, setFill] = useState<FillFormState>(DEMO_FILL);
  const [co, setCo] = useState(() => demoCohead("mock"));
  const [qEv, setQEv] = useState<AgentEvent[]>([]);
  const [pEv, setPEv] = useState<AgentEvent[]>([]);
  const [cEv, setCEv] = useState<AgentEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState(() => sp.get("sources") === "1");
  const openSources = useCallback(() => { setSources(true); setTimeout(() => document.getElementById("sources")?.scrollIntoView({ behavior: "smooth" }), 0); }, []);

  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((j: { modes: NonNullable<Modes> }) => {
      setModes(j.modes);
      // Live Qloo has no fictional demo acts: swap in the live demo unless the user has typed already.
      if (j.modes.qloo !== "live") return;
      setFill((f) => (f === DEMO_FILL ? demoFill("live") : f));
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

  const q = resultOf<FillPlan>(qEv), p = resultOf<PlainFillPlan>(pEv), c = resultOf<CoheadPlan>(cEv);
  const qErr = errorOf(qEv), pErr = errorOf(pEv), cErr = errorOf(cEv);
  const qMap = useFillMap(q);
  const started = tab === "fill" ? qEv.length > 0 || busy : cEv.length > 0 || busy;

  return (
    <div className="flex flex-col min-h-screen">
      <ModeBanner modes={modes} />
      <header className="max-w-7xl w-full mx-auto px-5 pt-7 pb-4 grid gap-4">
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Routed<span className="text-accent">.</span></h1>
            <p className="text-sm max-w-2xl"><b>Routed is a decision tool for booking agents and promoters.</b> <span className="text-plain">Fixed dates in, gap cities with real road miles and hours out. Two acts in, a complementary fan map out. Fan heat comes from Qloo, roads from OSRM/OpenStreetMap, markets from the U.S. Census; every rule is cited or marked as an assumption. Decisions are computed in code; the LLM only explains.</span></p>
          </div>
          <div className="flex items-center gap-2">
          <button onClick={() => (sources ? setSources(false) : openSources())} className={`text-sm border rounded-lg px-3 py-2 ${sources ? "border-accent text-accent" : "border-line text-plain"}`}>Sources &amp; methodology</button>
          <div className="flex bg-panel border border-line rounded-lg p-1 text-sm">
            {([["fill", "Fill the gaps"], ["cohead", "Co-headliner match"]] as [Tab, string][]).map(([t, l]) => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-md ${tab === t ? "bg-accent text-black" : "text-plain"}`}>{l}</button>
            ))}
          </div>
          </div>
        </div>
        {tab === "fill" ? <FillForm value={fill} onChange={setFill} onSubmit={() => runFill(fill)} busy={busy} onSources={openSources} /> : (
          <form onSubmit={(e) => { e.preventDefault(); runCo(co); }} className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <label className="grid gap-1 text-xs text-plain">Your act<input required value={co.artist} onChange={(e) => setCo({ ...co, artist: e.target.value })} className="bg-panel border border-line rounded-lg px-3 py-2.5 text-base text-foreground" /></label>
            <label className="grid gap-1 text-xs text-plain">Proposed co-headliner (optional; Routed also scans peers)<input value={co.partner} onChange={(e) => setCo({ ...co, partner: e.target.value })} className="bg-panel border border-line rounded-lg px-3 py-2.5 text-base text-foreground" /></label>
            <button disabled={busy} className="bg-accent text-black font-semibold rounded-lg px-5 py-2.5 disabled:opacity-50">{busy ? "Comparing…" : "Match co-headliners"}</button>
          </form>
        )}
      </header>

      <main className="max-w-7xl w-full mx-auto px-5 pb-16 grid gap-5">
        {sources && <SourcesPanel onClose={() => setSources(false)} />}
        {!started && <Landing tab={tab} live={modes?.qloo === "live"} onDemo={() => (tab === "fill" ? runFill(fill) : runCo(co))} />}

        {started && tab === "fill" && (
          <>
            <div className="flex justify-between items-center flex-wrap gap-3">
              {q ? (rank === "with" ? <FillStats q={q} /> : <div className="text-sm text-plain max-w-xl">Without Qloo: the same filtered cities, ordered by Census population and OSM venues. No fan signal, so no schedule is built.</div>) : <div className="text-sm text-plain">{qErr ? "No routing." : "Agent is routing…"}</div>}
              <QlooToggle value={rank} onChange={setRank} />
            </div>
            {qErr && <ErrorPanel error={qErr} context="Routed + Qloo" onRetry={busy ? undefined : () => runFill(fill)} />}
            {q && <WarningList warnings={q.warnings} />}
            {q && <RankedLists ranked={q.ranked} mode={rank} picked={new Set(q.stops.map((x) => x.city))} />}
            {q && rank === "with" && <FillSummary q={q} />}
            {rank === "with" && (
              <div className="grid lg:grid-cols-[1fr_370px] gap-5">
                <div className="grid gap-4 content-start min-w-0">
                  {q && <FillCalendar days={q.result.calendar} />}
                  <MapView rings={qMap?.rings} cells={qMap?.cells} paths={qMap?.paths} markers={qMap?.markers} fit={qMap?.fit} height={420} />
                  {q && <CandidateFilter gaps={q.result.gaps} maxDriveMi={q.params.maxDriveMi} />}
                  <div className="grid md:grid-cols-2 gap-4">{q?.stops.map((s) => <FillStopCard key={s.date} s={s} />)}</div>
                </div>
                <AgentTrace events={qEv} title="Agent trace · Qloo calls" />
              </div>
            )}
            {rank === "without" && q && (
              <MapView rings={qMap?.rings} fit={qMap?.fit} height={360}
                markers={[...q.anchors.map((a) => ({ lat: a.lat, lon: a.lon, color: "#ffffff", radius: 8, label: `★ ${a.city}`, dir: "left" as const })),
                  ...q.ranked.flatMap((g) => g.withoutQloo.slice(0, 5).map((c, i) => ({ lat: c.lat, lon: c.lon, color: "#8b93a7", label: `${i + 1}. ${c.name}` })))]} />
            )}

            <section className="grid gap-3 border-t border-line pt-4">
              <div className="flex justify-between items-center flex-wrap gap-2">
                <div className="text-sm"><b>Secondary baseline: an LLM with no tools.</b> <span className="text-plain">The same anchors given to a plain LLM (no Qloo, no rules), audited in code.</span></div>
                <div className="flex bg-panel border border-line rounded-lg p-1 text-xs">
                  {([["off", "Hide"], ["plain", "Plain AI"], ["compare", "Compare"]] as [Baseline, string][]).map(([v, l]) => (
                    <button key={v} onClick={() => setBaseline(v)} className={`px-2.5 py-1 rounded-md ${baseline === v ? "bg-plain text-black" : "text-plain"}`}>{l}</button>
                  ))}
                </div>
              </div>
              {baseline !== "off" && pErr && <ErrorPanel error={pErr} context="Plain AI baseline" onRetry={busy ? undefined : () => runFill(fill)} />}
              {baseline === "plain" && p && (() => {
                const pc = plainCalendar(p, q);
                const pts = pc.days.filter((d) => d.kind !== "off" && d.lat !== undefined).map((d) => ({ lat: d.lat!, lon: d.lon! }));
                const markers = pc.days.filter((d) => d.kind !== "off" && d.lat !== undefined).map((d) => ({ lat: d.lat!, lon: d.lon!, color: d.kind === "anchor" ? "#fff" : pc.flagged.has(d.date) ? "#ef4444" : "#8b93a7", label: d.kind === "anchor" ? `★ ${d.city}` : d.city, dir: (d.kind === "anchor" ? "left" : "right") as "left" | "right" }));
                return (
                  <div className="grid gap-4">
                    <div className="text-sm text-plain">{p.simulated && <span className="mr-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-200">SIMULATED</span>}Baseline for comparison only: the same anchors given to an LLM with no tools, no Qloo and no rules, answering from general knowledge. Its picks are then audited in code with OSRM road data and Routed&apos;s touring rules; red = breaks a rule.</div>
                    <FillCalendar days={pc.days} plain flagged={pc.flagged} />
                    <div className="grid lg:grid-cols-2 gap-4"><MapView paths={[{ pts, color: "#8b93a7", dash: "6 6" }]} markers={markers} fit={qMap?.fit} height={380} /><PlainAudit p={p} q={q} /></div>
                  </div>
                );
              })()}
              {baseline === "compare" && (
                <div className="grid gap-4">
                  <FillCompare q={q} p={p} />
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="grid gap-2"><h3 className="text-sm font-semibold text-accent">Routed + Qloo</h3>{q && <FillCalendar days={q.result.calendar} />}</div>
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
            {c ? <CoheadView plan={c} mode={rank} /> : !cErr && <div className="text-sm text-plain">Comparing fan geography…</div>}
            <AgentTrace events={cEv} title="Agent trace · Qloo calls" />
          </div>
        )}
      </main>
      <footer className="text-xs text-plain text-center pb-6 grid gap-1 px-5">
        <div>Taste data from the Qloo Taste AI™ API. Road distances and times: <a className="underline" href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a>, precomputed. Map data, city centres and venue counts © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a> (ODbL) · <a className="underline" href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">fix the map</a>. Population and metro areas: U.S. Census Bureau.</div>
        <div><button onClick={openSources} className="underline">Sources &amp; methodology</button> · Built for the Qloo Agentic Hackathon.</div>
      </footer>
    </div>
  );
}

/** The primary comparison: same hard-filtered candidates, ranked with Qloo affinity or without it. Default With Qloo. */
function QlooToggle({ value, onChange }: { value: RankMode; onChange: (m: RankMode) => void }) {
  return (
    <div role="tablist" aria-label="Ranking signal" className="flex bg-panel border border-line rounded-lg p-1 text-sm">
      {([["with", "With Qloo"], ["without", "Without Qloo"]] as [RankMode, string][]).map(([v, l]) => (
        <button key={v} role="tab" aria-selected={value === v} onClick={() => onChange(v)} className={`px-3 py-1.5 rounded-md ${value === v ? (v === "with" ? "bg-accent text-black" : "bg-plain text-black") : "text-plain"}`}>{l}</button>
      ))}
    </div>
  );
}

function Landing({ tab, live, onDemo }: { tab: Tab; live: boolean; onDemo: () => void }) {
  const f = demoFill(live ? "live" : "mock"), c = demoCohead(live ? "live" : "mock");
  const cards = [
    ["Fill the gaps", "Fixed dates in → gap cities + drive times out", "Enter the confirmed anchors. Routed reads the act's Qloo fan heatmap along each drive corridor, removes cities that break touring rules (radius clauses, backtracking, OSRM road miles and hours per day, days off), and fills off days with the strongest markets left. Fewer empty nights."],
    ["Co-headliner match", "Two acts in → complementary fan map out", "Routed reads both acts' nationwide Qloo heatmaps and scores complementarity: where A is strong and B is weak, and the reverse. The map shows which act carries each city. Co-bills where each act brings its own markets."],
    ["Receipts", "Every number has a source", "Fan heat and complementarity from Qloo, road miles and hours from OSRM, population from the Census, venue counts from OpenStreetMap, rules cited or labelled as assumptions. The LLM orchestrates and explains; text with a number not in the data is dropped."],
  ];
  return (
    <div className="grid gap-5">
      <div className="grid md:grid-cols-3 gap-4">
        {cards.map(([t, s, d], i) => (
          <div key={t} className={`bg-panel border rounded-xl p-4 ${(tab === "fill" && i === 0) || (tab === "cohead" && i === 1) ? "border-accent/60" : "border-line"}`}>
            <div className="text-accent font-mono text-xs">0{i + 1}</div>
            <div className="font-semibold mt-1">{t}</div>
            <div className="text-sm mt-0.5">{s}</div>
            <div className="text-sm text-plain mt-2">{d}</div>
          </div>
        ))}
      </div>
      <div className="text-sm text-plain">Demo is prefilled: <button onClick={onDemo} className="text-accent underline">{tab === "fill" ? `route ${f.artist}'s 3 anchors` : `match ${c.artist} with co-headliners`}</button> <span className="opacity-60">{live ? "(real acts, live Qloo data)" : "(fictional demo acts in mock mode)"}</span></div>
      <MapView height={300} />
    </div>
  );
}
