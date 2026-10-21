#!/usr/bin/env node
// Live sensitivity check for how Fanpoint reads Qloo heatmap cells at cities (metroReadRadiusMi) and where the
// thresholds sit. Fetches the same corridor / lower-48 heatmaps the app requests for the baseline input set and
// prints AGGREGATE statistics only (quantiles, coverage, spread). No response data is printed or saved.
//
//   QLOO_API_KEY=… node scripts/heat-read-sensitivity.mjs [--radii 3,5,10,15,25] [--delay-ms 400]
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } });
const { corridor, LOWER48_WKT } = await jiti.import("../src/lib/route/geo.ts");
const { findCity, US_CITIES } = await jiti.import("../src/lib/route/cities.ts");
const { readCities } = await jiti.import("../src/lib/qloo/heat.ts");
const { RULE_VALUES } = await jiti.import("../src/lib/touring/rules.ts");

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const RADII = arg("radii", "3,5,10,15,25").split(",").map(Number);
const DELAY = Number(arg("delay-ms", "400"));
const KEY = process.env.QLOO_API_KEY;
if (!KEY) { console.error("QLOO_API_KEY is not set."); process.exit(2); }
const BASE = "https://hackathon.api.qloo.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(path, params) {
  await sleep(DELAY);
  const r = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { "X-Api-Key": KEY, accept: "application/json" } });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}
const heat = async (id, wkt) => (await get("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": id, "filter.location": wkt })).results.heatmap
  .map((c) => ({ lat: c.location.latitude, lon: c.location.longitude, affinity: c.query.affinity, affinityRank: c.query.affinity_rank }));
const q = (xs, p) => { const v = [...xs].sort((a, b) => a - b); return v.length ? v[Math.round((v.length - 1) * p)] : NaN; };
const f = (x) => (Number.isFinite(x) ? x.toFixed(3) : "–");

const inputs = JSON.parse(readFileSync(new URL("./baseline/inputs.v1.json", import.meta.url)));
const artists = [...new Set(inputs.fill.filter((x) => !x.mockOnly).map((x) => x.artist))];
const ids = {};
for (const a of artists) ids[a] = (await get("/search", { query: a, types: "urn:entity:artist", take: "1" })).results[0].entity_id;

// 1) Corridor reads (fill): every real-artist fill input, every leg.
const corridorReads = Object.fromEntries(RADII.map((r) => [r, { reads: [], legs: 0, covered: 0, inRing: 0, spreads: [] }]));
let rawCells = [];
for (const inp of inputs.fill.filter((x) => !x.mockOnly)) {
  const anchors = inputs.dateSets[inp.dateSet].map((a) => findCity(a.city));
  for (let k = 0; k + 1 < anchors.length; k++) {
    const { ring, wkt } = corridor(anchors[k], anchors[k + 1], RULE_VALUES.corridorBufferMi);
    const cells = await heat(ids[inp.artist], wkt);
    rawCells.push(...cells.map((c) => c.affinity));
    const nIn = readCities(cells.map((c) => ({ ...c, affinity: 1 })), US_CITIES, 200, ring).length; // cities inside the ring
    for (const r of RADII) {
      const reads = readCities(cells, US_CITIES, r, ring).map((c) => c.affinity);
      const s = corridorReads[r];
      s.legs++; s.inRing += nIn; s.covered += reads.length; s.reads.push(...reads);
      if (reads.length >= 4) s.spreads.push(q(reads, 0.75) - q(reads, 0.25));
    }
  }
}
console.log(`Corridor heatmaps: ${corridorReads[RADII[0]].legs} legs, ${rawCells.length} cells. Raw cell affinity quantiles p10/p25/p50/p75/p90: ${[0.1, 0.25, 0.5, 0.75, 0.9].map((p) => f(q(rawCells, p))).join(" / ")}`);
console.log("\n| Read radius (mi) | Cities read / in corridor | p10 | p25 | median | p60 | p75 | p90 | share ≥ 0.95 | median per-leg IQR |\n|---|---|---|---|---|---|---|---|---|---|");
for (const r of RADII) {
  const s = corridorReads[r];
  console.log(`| ${r}${r === RULE_VALUES.metroReadRadiusMi ? " (current)" : ""} | ${s.covered} / ${s.inRing} (${Math.round((100 * s.covered) / s.inRing)}%) | ${[0.1, 0.25, 0.5, 0.6, 0.75, 0.9].map((p) => f(q(s.reads, p))).join(" | ")} | ${Math.round((100 * s.reads.filter((x) => x >= 0.95).length) / s.reads.length)}% | ${f(q(s.spreads, 0.5))} |`);
}

// 2) Lower-48 reads (co-headliner): the headliners of the real co-headliner inputs.
const heads = [...new Set(inputs.cohead.filter((x) => !x.mockOnly).flatMap((x) => [x.artist, x.partner].filter(Boolean)))];
console.log(`\nLower-48 heatmaps: ${heads.length} acts (headliners and partners of the real co-headliner inputs)`);
console.log("\n| Lower-48 read radius (mi) | Cities read / 385 per act | p10 | p25 | median | p60 | p75 | p90 |\n|---|---|---|---|---|---|---|---|");
const l48 = Object.fromEntries(RADII.map((r) => [r, { reads: [], covered: 0, n: 0 }]));
for (const a of heads) {
  const id = ids[a] ?? (await get("/search", { query: a, types: "urn:entity:artist", take: "1" })).results[0].entity_id;
  const cells = await heat(id, LOWER48_WKT);
  for (const r of RADII) { const reads = readCities(cells, US_CITIES, r).map((c) => c.affinity); l48[r].reads.push(...reads); l48[r].covered += reads.length; l48[r].n += US_CITIES.length; }
}
for (const r of RADII) { const s = l48[r]; console.log(`| ${r}${r === RULE_VALUES.metroReadRadiusMi ? " (current)" : ""} | ${s.covered} / ${s.n} (${Math.round((100 * s.covered) / s.n)}%) | ${[0.1, 0.25, 0.5, 0.6, 0.75, 0.9].map((p) => f(q(s.reads, p))).join(" | ")} |`); }
