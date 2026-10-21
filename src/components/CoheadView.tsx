"use client";
import { useMemo, useState } from "react";
import type { CoheadPlan } from "@/lib/agent/types";
import MapView, { type Marker } from "./MapView";
import { RULE_VALUES } from "@/lib/touring/rules";
import type { RankMode } from "@/lib/route/rank";
import { COHEAD_WITHOUT_QLOO_LINE, scoreLine } from "@/lib/route/score-line";
import WhyPopover from "./WhyPopover";
import { ACCENT, CYAN, PLAIN } from "./palette";

const pct = (a?: number) => (a === undefined ? "–" : `${Math.round(a * 100)}`);
const YOU = ACCENT, THEM = CYAN, BOTH = "#f8fafc";

export default function CoheadView({ plan, mode = "with" }: { plan: CoheadPlan; mode?: RankMode }) {
  if (mode === "without") return <CoheadWithout plan={plan} />;
  return <CoheadWith plan={plan} />;
}

/**
 * Without Qloo: the same peer names, but no fan geography, so there is nothing to rank them by. Shown alphabetically,
 * nothing recommended. (Without Qloo you would not even have this peer list: it came from Qloo's popularity-band search.)
 */
export function CoheadWithout({ plan }: { plan: CoheadPlan }) {
  const peers = [...plan.peers].sort((a, b) => a.entity.name.localeCompare(b.entity.name));
  return (
    <div className="grid gap-3 max-w-3xl">
      <div className="border border-dashed border-line rounded-xl p-3 text-sm">
        <b>No fan signal, so no pairing can be judged.</b> <span className="text-plain">Complementarity needs each act&apos;s Qloo affinity per city (where one is strong and the other weak). Without it every pairing looks the same: the peers below are listed alphabetically, none is recommended. The peer names themselves came from Qloo; without Qloo there would be no list at all.</span>
      </div>
      {peers.map((p) => (
        <div key={p.entity.id} className="card bg-panel p-3 grid gap-1">
          <span className="font-semibold">{p.entity.name}{p.requested && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-plain align-middle">your pick</span>}</span>
          <span className="text-[11px] font-mono text-plain" data-score-line>{COHEAD_WITHOUT_QLOO_LINE}</span>
        </div>
      ))}
    </div>
  );
}

function CoheadWith({ plan }: { plan: CoheadPlan }) {
  const [sel, setSel] = useState(plan.peers.find((p) => p.requested)?.entity.id ?? plan.peers.find((p) => p.picked)?.entity.id ?? plan.peers[0]?.entity.id);
  const peer = plan.peers.find((p) => p.entity.id === sel);
  const mostSimilar = [...plan.peers].sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0))[0];
  const { strong } = plan.thresholds;

  const markers = useMemo<Marker[]>(() => {
    if (!peer) return [];
    const gain = new Set(peer.youGain.slice(0, 6)), give = new Set(peer.theyGain.slice(0, 4));
    return plan.cities.flatMap<Marker>((c) => {
      const a = c.you, read = c.peers[peer.entity.id], b = read ?? 0;
      const sa = a >= strong, sb = b >= strong;
      if (!sa && !sb) return [{ lat: c.lat, lon: c.lon, color: "#2e3440", radius: 3, stroke: "#0f1115", tooltip: `${c.name}: you ${pct(a)} · them ${read == null ? "no data" : pct(read)}` }];
      const color = sa && sb ? BOTH : sa ? YOU : THEM;
      const label = gain.has(c.name) ? `+ ${c.name}` : give.has(c.name) ? c.name : undefined;
      return [{ lat: c.lat, lon: c.lon, color, radius: 4 + Math.max(a, b) * 5, label, dir: "right" as const, tooltip: `${c.name}: you ${pct(a)} · them ${read == null ? "no data" : pct(read)}` }];
    });
  }, [peer, plan.cities, strong]);

  return (
    <div className="grid lg:grid-cols-[360px_1fr] gap-5">
      <div className="grid gap-2 content-start">
        <div className="text-xs text-plain">Peers in {plan.artist.name}&apos;s popularity band, ranked by <b className="text-foreground">fan-geography complementarity</b> (not similarity)</div>
        <div className="text-sm">{plan.summary}</div>
        {plan.aiSummary && <div className="text-sm text-plain"><span className="text-[10px] mr-1.5 px-1.5 py-0.5 rounded bg-white/5 border border-line align-middle">AI summary</span>{plan.aiSummary}</div>}
        <div className="text-[11px] text-plain">Score = cities you gain + cities they gain − {RULE_VALUES.coheadAsymmetryPenalty} × imbalance − {RULE_VALUES.coheadOverlapPenalty} × shared strong cities. Strong ≥ {pct(plan.thresholds.strong)}, weak &lt; {pct(plan.thresholds.weak)} Qloo heat. Weights and thresholds are assumptions (see Sources &amp; methodology). &ldquo;Recommended&rdquo; = top 3 positive scores, computed in code.</div>
        {plan.peers.map((p, i) => (
          <button key={p.entity.id} onClick={() => setSel(p.entity.id)} className={`text-left bg-panel border rounded-xl p-3 grid gap-1.5 ${p.entity.id === sel ? "border-accent" : "border-line"}`}>
            <div className="flex justify-between items-baseline">
              <span className="font-semibold">{i + 1}. {p.entity.name}{p.picked && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-accent/20 text-accent align-middle">recommended</span>}{p.requested && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-plain align-middle">your pick</span>}</span>
              <span className="text-right leading-none"><span className="font-mono text-sm" style={{ color: p.score > 0 ? THEM : PLAIN }}>{p.score > 0 ? "+" : ""}{p.score}</span><span className="block text-[9px] uppercase tracking-wide text-plain">complementarity</span></span>
            </div>
            <div className="text-[11px] font-mono text-accent" data-score-line title="Qloo affinity of this peer for your act; the order is the complementarity of both acts' per-city Qloo affinity">{scoreLine("with", p.similarity)}</div>
            <div className="flex gap-3 text-xs text-plain">
              <span>similarity <b className="text-foreground font-mono">{pct(p.similarity)}</b></span>
              <span style={{ color: THEM }}>+{p.youGain.length} for you</span>
              <span style={{ color: YOU }}>+{p.theyGain.length} for them</span>
              <span>{p.overlap.length} overlap</span>
            </div>
          </button>
        ))}
      </div>
      <div className="grid gap-3 content-start">
        {peer && (
          <>
            <div className="flex flex-wrap gap-4 items-center text-xs">
              <Legend c={YOU} t={`${plan.artist.name} strong`} /><Legend c={THEM} t={`${peer.entity.name} strong`} /><Legend c={BOTH} t="both strong (overlap)" />
              <span className="text-plain">strong = Qloo fan heat ≥ {pct(strong)} · weak &lt; {pct(plan.thresholds.weak)}</span>
            </div>
            <div className="text-sm">Together: <b className="font-mono">{peer.coveredStrong}</b> cities where at least one act is strong, vs <b className="font-mono">{peer.youStrong}</b> for {plan.artist.name} alone and <b className="font-mono">{peer.themStrong}</b> for {peer.entity.name} alone. <span className="text-plain">More nights where one act carries the room.</span></div>
            <MapView markers={markers} height={430} />
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <div className="card bg-panel p-3"><div className="text-[10px] uppercase tracking-wide" style={{ color: THEM }}>You gain (weak for you, strong for them)</div><div>{peer.youGain.join(", ") || "none"}</div></div>
              <div className="card bg-panel p-3"><div className="text-[10px] uppercase tracking-wide" style={{ color: YOU }}>They gain (strong for you, weak for them)</div><div>{peer.theyGain.join(", ") || "none"}</div></div>
            </div>
            {peer.pitch && <div className="border border-accent/40 bg-accent/5 rounded-xl p-3 text-sm flex items-center gap-1.5"><span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-line text-plain" title="Written by the LLM; numbers checked against the scores">AI pitch</span><WhyPopover label={`AI pitch for ${peer.entity.name}`}>{peer.pitch}</WhyPopover></div>}
            {mostSimilar && mostSimilar.entity.id !== plan.peers[0]?.entity.id && (
              <div className="text-xs text-plain border border-line rounded-xl p-3">
                <b className="text-foreground">Most similar ≠ best partner.</b> {mostSimilar.entity.name} is the most taste-similar peer ({pct(mostSimilar.similarity)}),
                but its fans live in the same cities ({mostSimilar.overlap.length} overlap, +{mostSimilar.youGain.length} new for you). Similarity alone would pick it.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Legend({ c, t }: { c: string; t: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{t}</span>;
}
