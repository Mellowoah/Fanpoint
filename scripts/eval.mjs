// Fill-the-gaps eval: Routed + Qloo vs Plain AI on the same anchors, for several artists.
// Usage: BASE_URL=http://localhost:3000 node scripts/eval.mjs "Artist A" "Artist B" ...
// Anchors default to the UI demo routing (New York Nov 13 -> Durham Nov 21 -> Atlanta Nov 28); override with ANCHORS='[{"city":..,"date":..}]'.
// Plain-AI cities are scored with the SAME Qloo corridor reads from the Qloo run. Run with LIVE keys for numbers you can publish.
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const anchors = JSON.parse(process.env.ANCHORS ?? '[{"city":"New York","date":"2026-11-13"},{"city":"Durham","date":"2026-11-21"},{"city":"Atlanta","date":"2026-11-28"}]');
const artists = process.argv.slice(2);
if (!artists.length) { console.error("Pass artist names as arguments."); process.exit(1); }

async function plan(artist, mode) {
  const r = await fetch(`${BASE}/api/plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: "fill", artist, anchors, maxDriveMi: 350, mode }) /* heat floor: server default (rules.ts) */ });
  return (await r.text()).trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "result")?.plan;
}
const avg = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) : null; };
const rows = [];
// PLAIN_ONLY=1: re-run only the Plain AI side (1 LLM call per act) to see run-to-run variance; no Qloo-scored columns.
if (process.env.PLAIN_ONLY === "1") {
  for (const a of artists) {
    const p = await plan(a, "plain");
    if (!p) { rows.push({ artist: a, error: "no plan" }); continue; }
    const bad = (f) => p.audit.filter((x) => !x.anchor && f(x)).length;
    rows.push({ artist: a, llm: p.providers.llm, plain_simulated: p.simulated, plain_fills: p.stops.length,
      plain_radius: bad((x) => x.radiusConflict), plain_backtrack: bad((x) => x.doublesBack), plain_overdrive: bad((x) => x.overDrive),
      plain_date_conflict: bad((x) => x.dateConflict), plain_longest_run: p.longestRun ?? null });
  }
  console.table(rows);
  if (process.env.EVAL_JSON) { const fs = await import("node:fs"); fs.writeFileSync(process.env.EVAL_JSON, JSON.stringify(rows, null, 2)); }
  process.exit(0);
}
for (const a of artists) {
  const [q, p] = await Promise.all([plan(a, "qloo"), plan(a, "plain")]);
  if (!q || !p) { rows.push({ artist: a, error: "no plan" }); continue; }
  const heat = new Map(q.corridors.flatMap((c) => c.candidates.map((x) => [x.name, x.affinity])));
  const bad = (f) => p.audit.filter((x) => !x.anchor && f(x)).length;
  rows.push({
    artist: a, qloo: q.providers.qloo, llm: p.providers.llm, plain_simulated: p.simulated, floor: q.params.minAffinity,
    off_days: q.result.offBefore, qloo_fills: q.result.fills, plain_fills: p.stops.length,
    qloo_avg_heat: avg(q.stops.map((s) => s.affinity)), plain_avg_heat: avg(p.stops.map((s) => heat.get(s.city))),
    plain_outside_corridor: p.stops.filter((s) => !heat.has(s.city)).length,
    plain_below_floor: p.stops.filter((s) => !(heat.get(s.city) >= q.params.minAffinity)).length,
    plain_radius: bad((x) => x.radiusConflict), plain_backtrack: bad((x) => x.doublesBack), plain_overdrive: bad((x) => x.overDrive),
    plain_date_conflict: bad((x) => x.dateConflict), plain_unmapped: bad((x) => !x.mapped),
    qloo_longest_run: q.result.longestRun ?? null, plain_longest_run: p.longestRun ?? null,
    qloo_grounded: `${q.grounding.grounded}/${q.grounding.referenced}`,
  });
}
console.table(rows);
if (process.env.EVAL_JSON) { const fs = await import("node:fs"); fs.writeFileSync(process.env.EVAL_JSON, JSON.stringify(rows, null, 2)); }
