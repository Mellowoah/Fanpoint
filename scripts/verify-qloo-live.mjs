#!/usr/bin/env node
// Live Qloo shape check: calls each endpoint Fanpoint uses and validates the response against src/lib/qloo/schemas.ts.
// Prints SHAPES ONLY (status, envelope keys, item counts, per-field types, numeric ranges), never response values or
// the key. The key comes from the environment (QLOO_API_KEY) and goes only into the X-Api-Key header.
//
//   QLOO_API_KEY=… node scripts/verify-qloo-live.mjs [--base https://hackathon.api.qloo.com] [--artist "Khruangbin"]
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } });
const S = await jiti.import("../src/lib/qloo/schemas.ts");
const { checkQlooBaseUrl } = await jiti.import("../src/lib/qloo/base-url.ts");
const { LOWER48_WKT } = await jiti.import("../src/lib/route/geo.ts");

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg("base", process.env.QLOO_BASE_URL ?? "https://hackathon.api.qloo.com");
const ARTIST = arg("artist", "Khruangbin");
const KEY = process.env.QLOO_API_KEY;
if (!KEY) { console.error("QLOO_API_KEY is not set."); process.exit(2); }
const chk = checkQlooBaseUrl(BASE);
if (!chk.ok) { console.error(`Refusing base URL: ${chk.reason}`); process.exit(2); }

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
/** Union of field paths -> types over the items (2 levels deep), so shapes can be compared without printing values. */
function shape(items) {
  const m = new Map();
  const add = (p, v) => { const s = m.get(p) ?? new Set(); s.add(typeOf(v)); m.set(p, s); };
  for (const it of items) for (const [k, v] of Object.entries(it ?? {})) {
    add(k, v);
    if (typeOf(v) === "object") for (const [k2, v2] of Object.entries(v)) add(`${k}.${k2}`, v2);
  }
  return [...m].map(([p, s]) => `${p}:${[...s].join("|")}`).sort();
}
const range = (xs) => { const v = xs.filter((x) => typeof x === "number"); return v.length ? `${Math.min(...v).toFixed(3)}..${Math.max(...v).toFixed(3)} (n=${v.length})` : "none"; };

async function call(path, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
  const t0 = Date.now();
  const r = await fetch(`${chk.url}${path}?${qs}`, { headers: { "X-Api-Key": KEY, accept: "application/json", "user-agent": "routed/0.1 verify" } });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: r.status, ms: Date.now() - t0, json };
}
function rawList(json) {
  const res = json?.results;
  if (Array.isArray(res)) return { where: "results[]", list: res };
  for (const k of ["entities", "heatmap", "tags"]) if (Array.isArray(res?.[k])) return { where: `results.${k}[]`, list: res[k] };
  return { where: `results:${typeOf(res)}`, list: [] };
}

const report = [];
async function check(name, path, params, parse, extra) {
  const r = await call(path, params);
  const top = r.json && typeof r.json === "object" ? Object.keys(r.json).join(",") : typeOf(r.json);
  const { where, list } = rawList(r.json);
  let parsed = null, err = null;
  try { parsed = parse(r.json); } catch (e) { err = e.message; }
  const line = { name, path, status: r.status, ms: r.ms, top, where, raw: list.length, parsed: parsed?.items.length ?? 0, dropped: parsed?.dropped ?? null, error: err, fields: shape(list.slice(0, 50)) };
  if (extra && parsed) Object.assign(line, extra(parsed.items, list));
  report.push(line);
  console.log(`\n## ${name}: GET ${path} -> ${r.status} (${r.ms} ms)\n  top-level: ${top} · list at ${where} · raw ${list.length} · zod ok ${line.parsed} · dropped ${line.dropped ?? "-"}${err ? ` · ENVELOPE ERROR ${err}` : ""}`);
  for (const k of Object.keys(line)) if (!["name", "path", "status", "ms", "top", "where", "raw", "parsed", "dropped", "error", "fields"].includes(k)) console.log(`  ${k}: ${line[k]}`);
  console.log(`  fields: ${line.fields.join("  ")}`);
  if (!parsed?.items.length && list[0]) { const p = (path === "/v2/tags" ? S.RawTagSchema : path.includes("heat") ? S.RawHeatCellSchema : S.RawEntitySchema).safeParse(list[0]); if (!p.success) console.log(`  first-item zod issues: ${p.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`); }
  return parsed?.items ?? [];
}

const found = await check("search", "/search", { query: ARTIST, types: "urn:entity:artist", take: 5 }, S.parseSearch, (it) => ({ popularity: range(it.map((e) => e.popularity)), typesSeen: [...new Set(it.flatMap((e) => [e.type, e.subtype, ...(e.types ?? [])]).filter(Boolean))].join(",") }));
const id = found[0]?.entity_id;
await check("tags (music venue)", "/v2/tags", { "filter.query": "music venue", "filter.tag.types": "urn:tag:category:place", take: 10 }, S.parseTags, (it) => ({ tagIdPrefix: [...new Set(it.map((t) => t.id.split(":").slice(0, 4).join(":")))].join(",") }));
if (!id) { console.log("\nNo artist id from /search; stopping."); process.exit(1); }
const pop = found[0].popularity;
await check("insights peers (artist)", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": id, "filter.exclude.entities": id, ...(pop !== undefined ? { "filter.popularity.min": Math.max(0, +(pop - 0.1).toFixed(3)), "filter.popularity.max": Math.min(1, +(pop + 0.1).toFixed(3)) } : {}), take: 12 }, S.parseInsights, (it) => ({ affinity: range(it.map((e) => e.query?.affinity)), popularity: range(it.map((e) => e.popularity)) }));
const corridor = "POLYGON((-74.2 40.9, -73.6 40.6, -78.6 35.8, -79.2 36.2, -74.2 40.9))"; // NY -> Durham band
await check("heatmap (corridor polygon)", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": id, "filter.location": corridor }, S.parseHeatmap, (it) => ({ affinity: range(it.map((c) => c.query.affinity)), affinity_rank: range(it.map((c) => c.query.affinity_rank)), popularity: range(it.map((c) => c.query.popularity)) }));
await check("heatmap (lower 48)", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": id, "filter.location": LOWER48_WKT }, S.parseHeatmap, (it) => ({ affinity: range(it.map((c) => c.query.affinity)), popularity: range(it.map((c) => c.query.popularity)) }));
await check("insights destination", "/v2/insights", { "filter.type": "urn:entity:destination", "signal.interests.entities": id, "filter.location": corridor, "filter.geocode.country_code": "US", take: 30 }, S.parseInsights, (it) => ({ affinity: range(it.map((e) => e.query?.affinity)) }));
const tagItems = (await call("/v2/tags", { "filter.query": "music venue", "filter.tag.types": "urn:tag:category:place", take: 10 })).json;
const tag = S.parseTags(tagItems).items[0]?.id;
await check("insights place (rooms)", "/v2/insights", { "filter.type": "urn:entity:place", "signal.interests.entities": id, "filter.location.query": "Richmond", ...(tag ? { "filter.tags": tag } : {}), take: 3 }, S.parseInsights, (it) => ({ withLatLon: it.filter((e) => typeof e.location?.lat === "number").length }));
await check("insights support (artist, local)", "/v2/insights", { "filter.type": "urn:entity:artist", "signal.interests.entities": id, "signal.location.query": "Richmond", "filter.exclude.entities": id, ...(pop !== undefined ? { "filter.popularity.max": pop } : {}), take: 3 }, S.parseInsights);
await check("insights brand", "/v2/insights", { "filter.type": "urn:entity:brand", "signal.interests.entities": id, "signal.location.query": "Richmond", take: 2 }, S.parseInsights);
await check("insights podcast", "/v2/insights", { "filter.type": "urn:entity:podcast", "signal.interests.entities": id, "signal.location.query": "Richmond", take: 2 }, S.parseInsights);
console.log(`\nSummary: ${report.map((r) => `${r.name} ${r.status} ${r.error ? "ENVELOPE-FAIL" : `${r.parsed}/${r.raw}`}`).join(" · ")}`);
