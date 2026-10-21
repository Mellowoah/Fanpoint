#!/usr/bin/env node
// Compare two baselines made by scripts/baseline.mjs (e.g. mock vs live), input by input. Prints markdown.
//
//   node scripts/compare-baselines.mjs baselines/mock-2026-10-19 baselines/live-2026-10-29 [--top 5] [--out report.md]
//
// A and B are baseline folders or baseline.json files. Rankings are compared by city/entity id.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { distribution, enteredLeft, fmt, hitRate, jaccard, kendallTau, spearman, topNOverlap } from "./baseline/metrics.mjs";

const load = (p) => JSON.parse(readFileSync(statSync(p).isDirectory() ? join(p, "baseline.json") : p, "utf8"));
const ids = (list) => (list ?? []).map((x) => x.id);
const names = (list, set) => set.map((id) => list.find((x) => x.id === id)?.name ?? id).join(", ") || "–";
const mean = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const dist = (d) => (d ? `${fmt(d.min)} / ${fmt(d.median)} / ${fmt(d.max)} (n=${d.n})` : "–");
const pct = (x) => (x === null ? "–" : `${Math.round(x * 100)}%`);

/** Ranking comparison of two ordered lists of {id,name}. */
export function rankCompare(a, b, n) {
  const A = ids(a), B = ids(b);
  return { overlap: topNOverlap(A, B, n), n: Math.min(n, Math.max(A.length, B.length)), jaccard: jaccard(A, B), tau: kendallTau(A, B), rho: spearman(A, B), ...enteredLeft(A, B, n) };
}

/** Everything the report needs for one fill run (one side). */
function fillSide(r, top) {
  const considered = r.gaps.flatMap((g) => g.qlooCandidates.considered);
  const floor = r.params?.minAffinity ?? r.rules?.minAffinity;
  const statuses = {};
  for (const c of considered) statuses[c.status] = (statuses[c.status] ?? 0) + 1;
  const drops = {};
  for (const d of r.gaps.flatMap((g) => g.droppedByHardFilters)) { const k = d.reason.split(":")[0]; drops[k] = (drops[k] ?? 0) + 1; }
  return {
    floor, statuses, drops, considered: considered.length,
    heatPass: hitRate(considered.map((c) => c.affinity), floor),
    affinity: distribution(r.gaps.flatMap((g) => g.withQloo.map((c) => c.affinity))),
    fills: r.withQloo.fills.map((f) => f.cityId ?? f.city), fillNames: r.withQloo.fills.map((f) => f.city),
    eligible: r.gaps.reduce((s, g) => s + g.eligible, 0),
    divergence: r.gaps.map((g) => rankCompare(g.withQloo, g.withoutQloo, top)),
  };
}

function coheadSide(r) {
  const all = [r.cityAffinity.you, ...Object.values(r.cityAffinity.peers)].flat().filter((x) => typeof x === "number");
  return {
    ranking: r.withQloo.ranking, recommended: r.withQloo.recommended,
    scores: distribution(r.withQloo.ranking.map((p) => p.score)),
    similarity: distribution(r.withQloo.ranking.map((p) => p.similarity)),
    strong: hitRate(all, r.thresholds.strong), weak: hitRate(all, r.thresholds.weak), thresholds: r.thresholds, cityReads: all.length,
  };
}

export function compare(a, b, top = 5) {
  const L = [];
  const ma = a.meta, mb = b.meta;
  L.push(`# Baseline comparison: ${ma.mode} (${ma.timestamp}) vs ${mb.mode} (${mb.timestamp})`, "");
  L.push("| | A | B |", "|---|---|---|");
  L.push(`| Qloo / LLM | ${ma.health.qloo} / ${ma.health.llm} | ${mb.health.qloo} / ${mb.health.llm} |`);
  L.push(`| Commit | ${ma.git.commit?.slice(0, 12)}${ma.git.dirty ? " (dirty)" : ""} | ${mb.git.commit?.slice(0, 12)}${mb.git.dirty ? " (dirty)" : ""} |`);
  L.push(`| Inputs | v${ma.inputs.version} ${ma.inputs.sha256.slice(0, 12)} | v${mb.inputs.version} ${mb.inputs.sha256.slice(0, 12)} |`);
  for (const f of Object.keys({ ...ma.data, ...mb.data })) L.push(`| ${f} | ${ma.data[f]?.slice(0, 12) ?? "–"} | ${mb.data[f]?.slice(0, 12) ?? "–"}${ma.data[f] !== mb.data[f] ? " **changed**" : ""} |`);
  L.push(`| Qloo requests | ${a.runs.reduce((s, r) => s + (r.qlooCalls?.length ?? 0), 0)} | ${b.runs.reduce((s, r) => s + (r.qlooCalls?.length ?? 0), 0)} |`);
  L.push("");
  if (ma.inputs.sha256 !== mb.inputs.sha256) L.push("> **Warning:** the input sets differ; only inputs with the same id are compared.", "");
  const ruleDiffs = [];
  const ra = a.runs.find((r) => r.rules)?.rules ?? {}, rb = b.runs.find((r) => r.rules)?.rules ?? {};
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) if (JSON.stringify(ra[k]) !== JSON.stringify(rb[k])) ruleDiffs.push(`\`${k}\` ${JSON.stringify(ra[k])} → ${JSON.stringify(rb[k])}`);
  L.push(`**Rule changes:** ${ruleDiffs.join(", ") || "none"}`, "");

  const byId = new Map(b.runs.map((r) => [r.id, r]));
  const errors = [];
  const rows = [], details = [];
  const ok = (r) => r && r.status === "ok";
  for (const ra of a.runs) {
    const rb = byId.get(ra.id);
    if (!ok(ra) || !ok(rb)) {
      errors.push(`| ${ra.id} | ${ra.status === "error" ? `\`${ra.error.code}\`` : "ok"} | ${!rb ? "missing" : rb.status === "error" ? `\`${rb.error.code}\`` : "ok"} | ${ra.mockOnly || rb?.mockOnly ? "mock-only input (fictional act): expected to fail live" : ""} |`);
      continue;
    }
    if (ra.kind === "fill") {
      const sa = fillSide(ra, top), sb = fillSide(rb, top);
      const legs = ra.gaps.map((ga) => { const gb = rb.gaps.find((g) => g.from === ga.from && g.to === ga.to); return { ga, gb, c: gb ? rankCompare(ga.withQloo, gb.withQloo, top) : null, w: gb ? rankCompare(ga.withoutQloo, gb.withoutQloo, top) : null }; });
      const fillJ = jaccard(sa.fills, sb.fills);
      rows.push(`| ${ra.id} | ${legs.map((l) => (l.c ? `${l.c.overlap}/${l.c.n}` : "–")).join(", ")} | ${fmt(mean(legs.map((l) => l.c?.tau)))} | ${fmt(mean(legs.map((l) => l.c?.rho)))} | ${sa.fills.length} → ${sb.fills.length} (J ${fmt(fillJ)}) | ${pct(sa.heatPass)} → ${pct(sb.heatPass)} | ${fmt(mean(sa.divergence.map((d) => d.overlap)), 1)} → ${fmt(mean(sb.divergence.map((d) => d.overlap)), 1)} |`);
      const D = [`### ${ra.id}`, ""];
      D.push(`| Leg | Eligible A → B | With Qloo top-${top} overlap | Jaccard (all eligible) | Kendall τ | Spearman ρ | Entered top-${top} | Left top-${top} | Without Qloo top-${top} overlap |`, "|---|---|---|---|---|---|---|---|---|");
      for (const { ga, gb, c, w } of legs) {
        if (!gb) { D.push(`| ${ga.from} → ${ga.to} | ${ga.eligible} → missing | | | | | | | |`); continue; }
        D.push(`| ${ga.from} → ${ga.to} | ${ga.eligible} → ${gb.eligible} | ${c.overlap}/${c.n} | ${fmt(c.jaccard)} | ${fmt(c.tau)} | ${fmt(c.rho)} | ${names(gb.withQloo, c.entered)} | ${names(ga.withQloo, c.left)} | ${w.overlap}/${w.n} |`);
      }
      D.push("", `- Affinity of eligible cities (min / median / max): A ${dist(sa.affinity)} · B ${dist(sb.affinity)}`);
      D.push(`- Heat floor (${sa.floor}): ${pct(sa.heatPass)} of ${sa.considered} Qloo-read candidates pass in A, ${pct(sb.heatPass)} of ${sb.considered} in B`);
      D.push(`- Candidate statuses: A ${JSON.stringify(sa.statuses)} · B ${JSON.stringify(sb.statuses)}`);
      D.push(`- Hard-filter drops: A ${JSON.stringify(sa.drops)} · B ${JSON.stringify(sb.drops)}`);
      D.push(`- Fills: A ${sa.fillNames.join(", ") || "none"} · B ${sb.fillNames.join(", ") || "none"}`);
      D.push(`- With vs Without top-${top} overlap per leg: A ${sa.divergence.map((d) => d.overlap).join(", ")} · B ${sb.divergence.map((d) => d.overlap).join(", ")} (lower = Qloo changes more)`, "");
      details.push(D.join("\n"));
    } else {
      const sa = coheadSide(ra), sb = coheadSide(rb);
      const c = rankCompare(sa.ranking, sb.ranking, top);
      rows.push(`| ${ra.id} | ${c.overlap}/${c.n} | ${fmt(c.tau)} | ${fmt(c.rho)} | ${sa.recommended.length} → ${sb.recommended.length} picks | strong ${pct(sa.strong)} → ${pct(sb.strong)} | ${sb.recommended.length} vs 0 unranked |`);
      const D = [`### ${ra.id}`, ""];
      D.push(`- Peer ranking top-${top} overlap ${c.overlap}/${c.n}, Jaccard ${fmt(c.jaccard)}, Kendall τ ${fmt(c.tau)}, Spearman ρ ${fmt(c.rho)}`);
      D.push(`- Entered: ${names(sb.ranking, c.entered)} · Left: ${names(sa.ranking, c.left)}`);
      D.push(`- Recommended: A ${sa.recommended.join(", ") || "none"} · B ${sb.recommended.join(", ") || "none"} (Without Qloo: none in both, by design)`);
      D.push(`- Complementarity (min / median / max): A ${dist(sa.scores)} · B ${dist(sb.scores)}`);
      D.push(`- Similarity: A ${dist(sa.similarity)} · B ${dist(sb.similarity)}`);
      D.push(`- City heat reads at or above strong ${sa.thresholds.strong} / weak ${sa.thresholds.weak}: A ${pct(sa.strong)} / ${pct(sa.weak)} of ${sa.cityReads} · B ${pct(sb.strong)} / ${pct(sb.weak)} of ${sb.cityReads}`, "");
      details.push(D.join("\n"));
    }
  }
  const missingInA = b.runs.filter((r) => !a.runs.some((x) => x.id === r.id)).map((r) => r.id);
  L.push(`## Overview (top-${top})`, "");
  L.push(`Fill rows: With Qloo top-${top} overlap per leg, mean Kendall τ / Spearman ρ over each leg's shared cities, fills A → B, share of Qloo-read candidates passing the heat floor, and mean With-vs-Without top-${top} overlap. Co-headliner rows: peer ranking overlap, τ, ρ, recommendations, and share of city reads at or above the strong threshold.`, "");
  L.push("| Input | Top-N overlap | Kendall τ | Spearman ρ | Fills / picks | Heat floor / strong | With vs Without |", "|---|---|---|---|---|---|---|");
  L.push(...rows, "");
  L.push("## Errored or missing inputs", "");
  if (errors.length || missingInA.length) { L.push("| Input | A | B | Note |", "|---|---|---|---|", ...errors, ...missingInA.map((id) => `| ${id} | missing | ok | |`), ""); } else L.push("None.", "");
  L.push("## Per input", "", ...details);
  return L.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pos = process.argv.slice(2).filter((x, i, all) => !x.startsWith("--") && !(all[i - 1]?.startsWith("--")));
  if (pos.length !== 2) { console.error("usage: node scripts/compare-baselines.mjs <baseline A> <baseline B> [--top 5] [--out report.md]"); process.exit(2); }
  const i = process.argv.indexOf("--top"), top = i > 0 ? Number(process.argv[i + 1]) : 5;
  const md = compare(load(pos[0]), load(pos[1]), top);
  const o = process.argv.indexOf("--out");
  if (o > 0) { writeFileSync(process.argv[o + 1], md); console.error(`Wrote ${process.argv[o + 1]}`); } else console.log(md);
}
