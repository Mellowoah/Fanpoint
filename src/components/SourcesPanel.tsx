"use client";
/**
 * "Sources & methodology": renders the rules registry (touring/rules.ts) and the dataset metadata directly, so what
 * the screen says is exactly what the code uses.
 */
import { KIND_LABEL, RULES, type RuleKind } from "@/lib/touring/rules";
import { MARKETS, MARKETS_META } from "@/lib/data/markets";

export const KIND_STYLE: Record<RuleKind, string> = {
  sourced: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  adapted: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  assumption: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  internal: "bg-white/5 text-plain border-line",
};
export function KindBadge({ kind }: { kind: RuleKind }) {
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border inline-block max-w-full sm:whitespace-nowrap ${KIND_STYLE[kind]}`}>{KIND_LABEL[kind]}</span>;
}

const fmt = (v: number | readonly number[]) => (Array.isArray(v) ? (v as number[]).join(" · ") : String(v));
const A = ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href} target="_blank" rel="noreferrer" className="text-accent-text underline underline-offset-2 break-words">{children}</a>;

const DATASETS: { name: string; what: string; license: string; links: [string, string][] }[] = [
  { name: "Qloo Taste AI™ Insights API", what: "Fan affinity (heatmaps), corridor ranks, support acts, rooms, brands, podcasts, peer acts. The only source of taste signals.", license: "Qloo API terms (hackathon key, server-side only)",
    links: [["Qloo docs", "https://docs.qloo.com/"]] },
  { name: "OSRM road routing on OpenStreetMap", what: `Road distance and drive time for every ordered pair of the ${MARKETS.length} markets, car profile, precomputed once (16 table requests at ≤1 req/s) and committed. No routing call at runtime.`, license: "Data © OpenStreetMap contributors, ODbL 1.0. OSRM is BSD-2. Demo server: FOSSGIS usage policy (light, non-commercial use).",
    links: [["OSRM", "https://project-osrm.org/"], ["Demo server policy", "https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server"], ["Fix the map", "https://www.openstreetmap.org/fixthemap"]] },
  { name: "U.S. Census Bureau: metro delineation + population", what: "Market universe: cities named in a Metropolitan Statistical Area title (OMB, July 2023), metro population ≥ 200,000, lower 48 + DC. City and metro populations: Vintage 2025 estimates.", license: "U.S. federal government work, public domain",
    links: [["Delineation files", "https://www.census.gov/geographies/reference-files/time-series/demo/metro-micro/delineation-files.html"], ["Population estimates", "https://www.census.gov/programs-surveys/popest/data/data-sets.html"], ["Gazetteer", "https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html"]] },
  { name: "OpenStreetMap via the Overpass API", what: `City centre points (place=city/town nodes) and live-performance venue counts: amenity=music_venue, nightclub or theatre, or live_music=yes, within ${MARKETS_META.venueRadiusMi} mi. Mapped presence, not a complete inventory: coverage varies by city.`, license: "© OpenStreetMap contributors, ODbL 1.0 (attribution required; derived counts are a produced work)",
    links: [["Copyright & license", "https://www.openstreetmap.org/copyright"], ["Overpass API", "https://wiki.openstreetmap.org/wiki/Overpass_API"]] },
];

export default function SourcesPanel({ onClose }: { onClose?: () => void }) {
  const rules = Object.entries(RULES);
  return (
    <section id="sources" className="card bg-panel p-5 grid gap-5 text-sm">
      <div className="flex justify-between items-start gap-3">
        <div>
          <h2 className="text-xl font-semibold">Sources &amp; methodology</h2>
          <p className="text-plain max-w-3xl mt-1">Routed&apos;s decisions are made in code from the data below. The LLM picks which tool to call next and writes plain-language notes; any number in its text must match the data or the text is dropped. Every rule has a status: <b>sourced</b> (default taken from a cited source), <b>adapted</b> (cited for a neighbouring context), <b>assumption</b> (Routed&apos;s default, no solid source: adjust it), or <b>implementation detail</b>.</p>
        </div>
        {onClose && <button onClick={onClose} className="btn btn-secondary btn-sm">Close</button>}
      </div>

      <div className="grid gap-2">
        <h3 className="font-semibold">Data</h3>
        <div className="grid md:grid-cols-2 gap-3">
          {DATASETS.map((d) => (
            <div key={d.name} className="border border-line rounded-xl bg-background/50 p-3.5 grid gap-1">
              <div className="font-medium">{d.name}</div>
              <div className="text-plain">{d.what}</div>
              <div className="text-xs"><span className="text-plain">License: </span>{d.license}</div>
              <div className="text-xs flex flex-wrap gap-x-3">{d.links.map(([l, u]) => <A key={u} href={u}>{l}</A>)}</div>
            </div>
          ))}
        </div>
        <div className="text-xs text-plain">Market data built {MARKETS_META.built} by <code>scripts/data/build_markets.py</code>. {MARKETS_META.rule}</div>
      </div>

      <div className="grid gap-2">
        <h3 className="font-semibold">Touring rules</h3>
        <div className="grid gap-0 border border-line rounded-xl overflow-hidden">
          {rules.map(([k, r]) => (
            <div key={k} className="grid md:grid-cols-[220px_110px_1fr] gap-x-3 gap-y-1 p-3 border-t border-line first:border-t-0">
              <div><div className="font-medium">{r.label}</div><code className="text-[10px] text-plain">{k}</code></div>
              <div className="grid content-start gap-1"><span className="font-mono">{fmt(r.value)}</span><span className="text-[10px] text-plain">{r.unit}</span></div>
              <div className="grid gap-1">
                <div className="flex flex-wrap gap-1.5 items-center"><KindBadge kind={r.kind} />{r.adjustable ? <span className="text-[10px] text-plain">adjustable in the form</span> : <span className="text-[10px] text-plain">set in src/lib/touring/rules.ts</span>}</div>
                <div className="text-plain">{r.why}</div>
                {r.sources.length > 0 && <ul className="text-xs grid gap-0.5">{r.sources.map((s) => <li key={s.url}><A href={s.url}>{s.title}</A> <span className="text-plain">({s.publisher}){s.note ? `: ${s.note}` : ""}</span></li>)}</ul>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-1 text-plain">
        <h3 className="font-semibold text-foreground">With Qloo / Without Qloo</h3>
        <p>Both modes rank the same cities: those in the drive corridor that pass the hard filters (Census market floor, anchors and radius clause, between the anchors, at least one OSM-mapped venue, OSRM road miles and hours per day). <b className="text-foreground">With Qloo</b> orders them by the act&apos;s Qloo affinity at each city. <b className="text-foreground">Without Qloo</b> uses a fixed proxy, set before looking at results: Census city population, with the OpenStreetMap venue count as the tie-break. For co-headliners, Without Qloo leaves the peers unranked, because without fan geography the pairing can&apos;t be judged.</p>
      </div>

      <div className="grid gap-1 text-plain">
        <h3 className="font-semibold text-foreground">What isn&apos;t modelled</h3>
        <p>No ticket-sales forecasts, venue capacities, availability, guarantees or routing costs: there is no open source for them. Drive times are free-flow car times (no traffic, stops or trailer). Radius clauses are checked as a straight-line distance; real contracts vary. Venue counts reflect OpenStreetMap mapping, not the full market.</p>
      </div>
    </section>
  );
}
