"use client";
import { useMemo, useState } from "react";
import type { CoheadPlan } from "@/lib/agent/types";
import MapView, { type Marker } from "./MapView";
import { RULE_VALUES } from "@/lib/touring/rules";
import type { RankMode } from "@/lib/route/rank";
import { COHEAD_WITHOUT_QLOO_LINE } from "@/lib/route/score-line";
import WhyPopover from "./WhyPopover";
import { ACCENT, ACCENT_TEXT, CYAN, PLAIN } from "./palette";
import { FanScore } from "./FanScore";
import { RoomCard, SharedTaste, SkewTable } from "./QlooPlus";

const pct = (a?: number) => (a === undefined ? "–" : `${Math.round(a * 100)}`);
const YOU = ACCENT, YOU_TEXT = ACCENT_TEXT, THEM = CYAN, BOTH = "#f8fafc";

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
        <b>No fan signal, so no pairing can be judged.</b> <WhyPopover label="why no ranking without Qloo" title="Why">Matching needs to know, city by city, where each act&apos;s fans are strong (Qloo). Without it every pairing looks the same: the acts below are listed alphabetically and none is recommended. The names themselves came from Qloo; without Qloo there would be no list at all.</WhyPopover>
      </div>
      {peers.map((p) => (
        <div key={p.entity.id} className="card bg-panel p-3 grid gap-1">
          <span className="font-semibold">{p.entity.name}{p.requested && <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-white/10 text-plain align-middle">your pick</span>}</span>
          <span className="text-xs font-mono text-plain" data-score-line>{COHEAD_WITHOUT_QLOO_LINE}</span>
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
        <div className="text-xs text-plain flex items-center gap-1.5 flex-wrap">Acts about as popular as {plan.artist.name}, ranked by <b className="text-foreground">how well their fan cities fill your gaps</b> (not by how similar they sound)
          <WhyPopover label="how co-headliners are scored" title="Score" wide>Match score = cities you gain + cities they gain − {RULE_VALUES.coheadAsymmetryPenalty} × how lopsided the trade is − {RULE_VALUES.coheadOverlapPenalty} × cities where both are already strong. A city is &ldquo;strong&rdquo; for an act at fan strength {pct(plan.thresholds.strong)}+ and &ldquo;weak&rdquo; below {pct(plan.thresholds.weak)} (Qloo, 0–100). The weights and cut-offs are our estimates (see Sources &amp; methodology). &ldquo;Recommended&rdquo; = the top 3 positive scores, computed in code.</WhyPopover>
        </div>
        <div className="text-sm">{plan.summary}</div>
        {plan.aiSummary && <div className="text-sm text-plain flex items-center gap-1.5"><span className="text-xs px-1.5 py-0.5 rounded bg-white/5 border border-line">AI summary</span><WhyPopover label="AI summary of the match" title="Read">{plan.aiSummary}</WhyPopover></div>}
        {plan.peers.map((p, i) => (
          <button key={p.entity.id} onClick={() => setSel(p.entity.id)} className={`text-left bg-panel border rounded-xl p-3 grid gap-1.5 ${p.entity.id === sel ? "border-accent" : "border-line"}`}>
            <div className="flex justify-between items-baseline">
              <span className="font-semibold">{i + 1}. {p.entity.name}{p.picked && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-accent/20 text-accent-text align-middle">recommended</span>}{p.requested && <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-white/10 text-plain align-middle">your pick</span>}</span>
              <span className="text-right leading-none"><span className="font-mono text-sm" style={{ color: p.score > 0 ? THEM : PLAIN }}>{p.score > 0 ? "+" : ""}{p.score}</span><span className="block text-xs text-plain">match score</span></span>
            </div>
            <FanScore affinity={p.similarity} kind="act" />
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-plain">
              <span style={{ color: THEM }}>+{p.youGain.length} cities for you</span>
              <span style={{ color: YOU_TEXT }}>+{p.theyGain.length} for them</span>
              <span>{p.overlap.length} where both are strong</span>
            </div>
          </button>
        ))}
      </div>
      <div className="grid gap-3 content-start">
        {peer && (
          <>
            <div className="flex flex-wrap gap-4 items-center text-xs">
              <Legend c={YOU} t={`${plan.artist.name}'s fans strong`} /><Legend c={THEM} t={`${peer.entity.name}'s fans strong`} /><Legend c={BOTH} t="both strong" />
              <span className="text-plain">strong = fan strength {pct(strong)}+ out of 100</span>
            </div>
            <div className="text-sm">Together: <b className="font-mono">{peer.coveredStrong}</b> cities where at least one act draws a strong crowd, vs <b className="font-mono">{peer.youStrong}</b> for {plan.artist.name} alone and <b className="font-mono">{peer.themStrong}</b> for {peer.entity.name} alone.</div>
            <MapView markers={markers} height={430} />
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <div className="card bg-panel p-3"><div className="text-xs" style={{ color: THEM }}>Cities you gain (their fans carry the night)</div><div>{peer.youGain.join(", ") || "none"}</div></div>
              <div className="card bg-panel p-3"><div className="text-xs" style={{ color: YOU_TEXT }}>Cities they gain (your fans carry the night)</div><div>{peer.theyGain.join(", ") || "none"}</div></div>
            </div>
            {(peer.shared?.length || peer.skew || peer.joint) && (
              <div className="card bg-panel p-3 grid gap-3" data-cohead-extras>
                <SharedTaste tags={peer.shared} />
                <SkewTable rows={[{ name: plan.artist.name, color: YOU_TEXT, d: plan.artistSkew }, { name: peer.entity.name, color: THEM, d: peer.skew }]} />
                {peer.joint && (
                  <div className="grid gap-1">
                    <div className="text-xs">Best shared city: <b>{peer.joint.city}</b>{peer.joint.region && !peer.joint.city.endsWith(`, ${peer.joint.region}`) ? `, ${peer.joint.region}` : ""} <span className="text-plain">(fan strength <span style={{ color: YOU_TEXT }}>{pct(peer.joint.you)}</span> / <span style={{ color: THEM }}>{pct(peer.joint.them)}</span>: the best city for both)</span></div>
                    {peer.joint.venue ? <RoomCard v={peer.joint.venue} heading="Room that suits both crowds" stopCity={peer.joint.city} /> : <div className="text-xs text-plain">No Qloo show room matched there.</div>}
                  </div>
                )}
              </div>
            )}
            {peer.pitch && <div className="border border-accent/40 bg-accent/5 rounded-xl p-3 text-sm flex items-center gap-1.5"><span className="text-xs px-1.5 py-0.5 rounded bg-white/5 border border-line text-plain" title="Written by the AI; numbers checked against the scores">AI pitch</span><span>Why pair with {peer.entity.name}</span><WhyPopover label={`AI pitch for ${peer.entity.name}`} title="Read">{peer.pitch}</WhyPopover></div>}
            {mostSimilar && mostSimilar.entity.id !== plan.peers[0]?.entity.id && (
              <div className="text-xs text-plain border border-line rounded-xl p-3 flex items-center gap-1.5 flex-wrap">
                <b className="text-foreground">Most similar ≠ best partner.</b>
                <WhyPopover label="most similar act" title="Why">{mostSimilar.entity.name} is the most similar act (fan overlap {pct(mostSimilar.similarity)}/100), but its fans live in the same cities ({mostSimilar.overlap.length} where both are strong, only +{mostSimilar.youGain.length} new for you). Similarity alone would pick it.</WhyPopover>
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
