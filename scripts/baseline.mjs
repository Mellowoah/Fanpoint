#!/usr/bin/env node
// Reproducible baseline: run a fixed input set (default scripts/baseline/inputs.v2.json) against a running Routed server and
// save everything needed to compare runs (mock now, live once QLOO_API_KEY arrives).
//
//   node scripts/baseline.mjs [--base http://localhost:3100] [--inputs scripts/baseline/inputs.v2.json]
//                             [--out baselines/<mode>-<date>] [--delay-ms 0] [--only id1,id2] [--force]
//
// Output (gitignored /baselines/): baseline.json (all runs + metadata) and summary.md. Qloo responses are NOT saved:
// each request is recorded as endpoint + params + a sha256 prefix of the response. What is kept are Routed's derived
// per-city scores (affinity read at a city, ranks, picks), which still come from Qloo: keep live baselines private
// (Qloo FAQ: no response data in a public repo). The script never sends keys; the server holds them.
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const BASE = arg("base", process.env.BASE_URL ?? "http://localhost:3100");
const INPUTS = arg("inputs", join(ROOT, "scripts/baseline/inputs.v2.json"));
const DELAY = Number(arg("delay-ms", "0"));
const ONLY = arg("only")?.split(",");

const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const fileHash = (rel) => { try { return sha(readFileSync(join(ROOT, rel))); } catch { return null; } };
const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Local ISO timestamp with offset, e.g. 2026-10-19T20:45:00-04:00. */
function isoLocal(d = new Date()) {
  const off = -d.getTimezoneOffset(), s = off >= 0 ? "+" : "-", p = (n) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${s}${p(off / 60)}:${p(off % 60)}`;
}

async function post(body) {
  const r = await fetch(`${BASE}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) { let e; try { e = JSON.parse(text).error; } catch { e = { message: text.slice(0, 300) }; } return { error: { code: e?.code ?? `http_${r.status}`, message: e?.message } }; }
  const events = text.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const err = events.find((e) => e.type === "error");
  const res = events.find((e) => e.type === "result");
  return res ? { plan: res.plan } : { error: { code: err?.code ?? "no_result", message: err?.message ?? "no result event" } };
}

const qlooCalls = (calls = []) => calls.map((c) => ({ endpoint: c.endpoint, params: c.params, status: c.status, resultCount: c.resultCount, dropped: c.dropped, responseHash: c.responseHash ?? null, ms: c.ms, error: c.error }));
const ent = (e) => ({ id: e.id, name: e.name, affinity: e.affinity, popularity: e.popularity });
const row = (c, i) => ({ rank: i + 1, id: c.id, name: c.name, region: c.region, affinity: c.affinity ?? null, popularity: c.popularity ?? null, population: c.population, venues: c.venues, fromA: c.fromA ?? null, toB: c.toB ?? null });

function recordFill(input, plan) {
  return {
    providers: plan.providers, params: plan.params, rules: plan.rules,
    stats: { offBefore: plan.result.offBefore, offAfter: plan.result.offAfter, fills: plan.result.fills, maxDayDrive: plan.result.maxDayDrive, maxDayHours: plan.result.maxDayHours, totalMi: plan.result.totalMi, totalHours: plan.result.totalHours, longestRun: plan.result.longestRun },
    gaps: plan.ranked.map((g, k) => {
      const routed = plan.result.gaps[k];
      const cor = plan.corridors[k];
      return {
        from: g.from, to: g.to, offDays: g.offDays, inCorridor: g.inCorridor, eligible: g.eligible, note: g.note ?? null,
        // Hard filters (identical in both modes), with the reason for every dropped corridor city.
        droppedByHardFilters: g.dropped,
        // The optimiser's view of the Qloo-read candidates: every status, including the Qloo heat floor.
        qlooCandidates: { source: cor?.source ?? null, read: cor?.candidates.length ?? 0, considered: routed?.considered ?? [] },
        withQloo: g.withQloo.map(row),
        withoutQloo: g.withoutQloo.map(row),
      };
    }),
    withQloo: {
      fills: plan.stops.map((s) => ({
        date: s.date, dow: s.dow, city: s.city, cityId: s.cityId, affinity: s.affinity, rankInCorridor: s.rankInCorridor ?? null, corridorSize: s.corridorSize ?? null,
        dowWeight: s.dowWeight, driveMi: s.driveMi, driveHours: s.driveHours ?? null, driveDays: s.driveDays, prevCity: s.prevCity, run: s.run ?? null,
        why: { headline: s.headline, text: s.why }, support: s.support.map(ent), venues: s.venues.map(ent), promo: s.promo.map((p) => ({ ...ent(p.entity), kind: p.entity.kind, angleBy: p.angleBy })),
      })),
      calendar: plan.result.calendar.map((d) => ({ date: d.date, kind: d.kind, city: d.city ?? null })),
    },
    withoutQloo: { fills: null, note: "No fan signal: Routed builds no schedule without Qloo; only the ranked lists exist." },
    warnings: plan.warnings, grounding: plan.grounding, qlooCalls: qlooCalls(plan.qlooCalls),
  };
}

function recordCohead(plan) {
  const peers = plan.peers.map((p, i) => ({
    rank: i + 1, id: p.entity.id, name: p.entity.name, score: p.score, similarity: p.similarity ?? null, picked: p.picked, requested: !!p.requested,
    youGain: p.youGain, theyGain: p.theyGain, overlap: p.overlap.length, coveredStrong: p.coveredStrong, youStrong: p.youStrong, themStrong: p.themStrong,
  }));
  return {
    providers: plan.providers, rules: plan.rules, thresholds: plan.thresholds, artist: ent(plan.artist),
    withQloo: { ranking: peers, recommended: peers.filter((p) => p.picked).map((p) => p.name) },
    withoutQloo: { ranking: null, alphabetical: [...peers].map((p) => p.name).sort((a, b) => a.localeCompare(b)), recommended: [], note: "Unranked: no fan signal to judge the pairing." },
    // Per-city affinity for the act and each peer (Routed's city reads of the Qloo heatmaps), for threshold hit rates.
    cityAffinity: { you: plan.cities.map((c) => c.you), peers: Object.fromEntries(plan.peers.map((p) => [p.entity.id, plan.cities.map((c) => c.peers[p.entity.id] ?? null)])) },
    warnings: plan.warnings, grounding: plan.grounding, qlooCalls: qlooCalls(plan.qlooCalls),
  };
}

function summary(b) {
  const L = [];
  const m = b.meta;
  L.push(`# Routed baseline: ${m.mode} (${m.timestamp})`, "");
  L.push(`- Inputs: \`${m.inputs.file}\` v${m.inputs.version} (sha256 ${m.inputs.sha256.slice(0, 12)}), ${b.runs.length} runs, ${b.runs.filter((r) => r.status === "error").length} errors`);
  L.push(`- Modes: Qloo **${m.health.qloo}**, LLM **${m.health.llm}** · server ${m.base}`);
  L.push(`- Commit \`${m.git.commit?.slice(0, 12)}\`${m.git.dirty ? " (dirty tree)" : ""} · data: markets ${m.data["src/lib/data/markets.json"]?.slice(0, 12)}, road matrix ${m.data["src/lib/data/road-matrix.json"]?.slice(0, 12)}, mock fixtures ${m.data["src/lib/qloo/fixtures/mock-qloo.json"]?.slice(0, 12)}`);
  L.push(`- Qloo requests recorded: ${b.runs.reduce((s, r) => s + (r.qlooCalls?.length ?? 0), 0)} (endpoint, params, response hash; no response data)`);
  if (m.health.qloo === "mock") L.push("", "> MOCK MODE: fictional fixtures. Use this only as the reference to compare a live run against, never as results.");
  L.push("");
  for (const r of b.runs) {
    L.push(`## ${r.id}`, "");
    if (r.status === "error") { L.push(`**Error** \`${r.error.code}\`: ${r.error.message ?? ""}${r.mockOnly ? " (mock-only input; expected in live mode)" : ""}`, ""); continue; }
    if (r.kind === "fill") {
      L.push(`${r.request.artist} · ${r.request.anchors.map((a) => `${a.city} ${a.date}`).join(" → ")} · off days ${r.stats.offBefore} → ${r.stats.offAfter}`, "");
      L.push("| Leg | Eligible | With Qloo top 5 (affinity) | Without Qloo top 5 (population) |", "|---|---|---|---|");
      for (const g of r.gaps) L.push(`| ${g.from} → ${g.to} | ${g.eligible}/${g.inCorridor} | ${g.withQloo.slice(0, 5).map((c) => `${c.name} ${c.affinity === null ? "–" : c.affinity.toFixed(2)}`).join(", ") || "–"} | ${g.withoutQloo.slice(0, 5).map((c) => c.name).join(", ") || "–"} |`);
      L.push("", `Routed fills: ${r.withQloo.fills.map((f) => `${f.date.slice(5)} ${f.city} (${f.affinity.toFixed(2)})`).join(" · ") || "none"}`, "");
    } else {
      L.push(`${r.request.artist}${r.request.partner ? ` + ${r.request.partner}` : ""} · recommended With Qloo: ${r.withQloo.recommended.join(", ") || "none"} · Without Qloo: none (unranked)`, "");
      L.push("| # | Peer | Complementarity | Similarity | +you / +them / overlap |", "|---|---|---|---|---|");
      for (const p of r.withQloo.ranking) L.push(`| ${p.rank} | ${p.name}${p.picked ? " ★" : ""}${p.requested ? " (requested)" : ""} | ${p.score} | ${p.similarity === null ? "–" : p.similarity.toFixed(2)} | ${p.youGain.length} / ${p.theyGain.length} / ${p.overlap} |`);
      L.push("");
    }
  }
  return L.join("\n");
}

async function main() {
  const inputsText = readFileSync(INPUTS);
  const inputs = JSON.parse(inputsText);
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json()).catch((e) => { console.error(`Cannot reach ${BASE}/api/health: ${e.message}. Start a server first (see docs/DEPLOY.md).`); process.exit(2); });
  const mode = health.modes.qloo;
  const now = new Date();
  const out = arg("out", join(ROOT, "baselines", `${mode}-${isoLocal(now).slice(0, 10)}`));
  if (existsSync(join(out, "baseline.json")) && !flag("force")) { console.error(`${out}/baseline.json exists. Pass --out <dir> or --force.`); process.exit(2); }

  const jobs = [
    ...inputs.fill.map((f) => ({ kind: "fill", spec: f, body: { task: "fill", artist: f.artist, anchors: inputs.dateSets[f.dateSet], maxDriveMi: f.maxDriveMi ?? inputs.defaults.maxDriveMi, ...((f.minAffinity ?? inputs.defaults.minAffinity) !== undefined ? { minAffinity: f.minAffinity ?? inputs.defaults.minAffinity } : {}), mode: "qloo" } })),
    ...inputs.cohead.map((c) => ({ kind: "cohead", spec: c, body: { task: "cohead", artist: c.artist, ...(c.partner ? { partner: c.partner } : {}) } })),
  ].filter((j) => !ONLY || ONLY.includes(j.spec.id));

  const runs = [];
  for (const [i, j] of jobs.entries()) {
    const t0 = Date.now();
    const res = await post(j.body);
    const base = { id: j.spec.id, kind: j.kind, mockOnly: !!j.spec.mockOnly, dateSet: j.spec.dateSet ?? null, request: j.body, ms: Date.now() - t0 };
    if (res.error) runs.push({ ...base, status: "error", error: res.error });
    else runs.push({ ...base, status: "ok", ...(j.kind === "fill" ? recordFill(j.spec, res.plan) : recordCohead(res.plan)) });
    console.log(`[${i + 1}/${jobs.length}] ${j.spec.id}: ${res.error ? `ERROR ${res.error.code}` : "ok"} (${Date.now() - t0} ms)`);
    if (DELAY) await sleep(DELAY);
  }

  const meta = {
    format: "routed-baseline/1", mode, timestamp: isoLocal(now), base: BASE, health: health.modes, node: process.version,
    git: { commit: sh("git rev-parse HEAD"), dirty: !!sh("git status --porcelain"), author: sh("git log -1 --format=%an") },
    inputs: { file: INPUTS.replace(ROOT, ""), version: inputs.version, sha256: sha(inputsText) },
    data: Object.fromEntries(["src/lib/data/markets.json", "src/lib/data/road-matrix.json", "src/lib/qloo/fixtures/mock-qloo.json", "src/lib/qloo/fixtures/mock-geo.ts", "src/lib/touring/rules.ts"].map((f) => [f, fileHash(f)])),
    dataMeta: (() => { try { const m = JSON.parse(readFileSync(join(ROOT, "src/lib/data/markets.json"), "utf8")).meta; const r = JSON.parse(readFileSync(join(ROOT, "src/lib/data/road-matrix.json"), "utf8")).meta; return { markets: m, roads: r }; } catch { return null; } })(),
  };
  const baseline = { meta, runs };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "baseline.json"), JSON.stringify(baseline, null, 1));
  writeFileSync(join(out, "summary.md"), summary(baseline));
  console.log(`\nSaved ${runs.length} runs (${runs.filter((r) => r.status === "error").length} errors) to ${out}/{baseline.json,summary.md}`);
}
main();
