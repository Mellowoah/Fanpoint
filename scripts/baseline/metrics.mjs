// Ranking-comparison metrics for compare-baselines.mjs. Pure functions on arrays of ids; tested in tests/baseline-metrics.test.ts.

/** |A ∩ B| for the first n items of each list. */
export function topNOverlap(a, b, n) {
  const sb = new Set(b.slice(0, n));
  return a.slice(0, n).filter((x) => sb.has(x)).length;
}

/** Jaccard index |A ∩ B| / |A ∪ B| of two sets (1 when both are empty). */
export function jaccard(a, b) {
  const sa = new Set(a), sb = new Set(b);
  const union = new Set([...sa, ...sb]);
  if (!union.size) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / union.size;
}

/** Items present in both lists, in a's order. */
const common = (a, b) => { const sb = new Set(b); return a.filter((x) => sb.has(x)); };

/**
 * Kendall's tau-b between the orders of two rankings, over the items they share (no ties within a ranking, so tau-a =
 * tau-b). Returns null when fewer than 2 items are shared.
 */
export function kendallTau(a, b) {
  const items = common(a, b);
  const n = items.length;
  if (n < 2) return null;
  const pb = new Map(b.map((x, i) => [x, i]));
  const ranksB = items.map((x) => pb.get(x));
  let conc = 0, disc = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const s = Math.sign(ranksB[j] - ranksB[i]); if (s > 0) conc++; else if (s < 0) disc++; }
  return (conc - disc) / (n * (n - 1) / 2);
}

/** Spearman's rho over the shared items (ranks re-numbered 1..n within the shared set). null when fewer than 2 shared. */
export function spearman(a, b) {
  const items = common(a, b);
  const n = items.length;
  if (n < 2) return null;
  const rb = new Map(common(b, a).map((x, i) => [x, i]));
  let d2 = 0;
  items.forEach((x, i) => { const d = i - rb.get(x); d2 += d * d; });
  return 1 - (6 * d2) / (n * (n * n - 1));
}

/** Cities that entered (in b, not a) and left (in a, not b) the first n. */
export function enteredLeft(a, b, n) {
  const ta = a.slice(0, n), tb = b.slice(0, n);
  const sa = new Set(ta), sb = new Set(tb);
  return { entered: tb.filter((x) => !sa.has(x)), left: ta.filter((x) => !sb.has(x)) };
}

/** min / p25 / median / p75 / max / mean of the finite numbers in xs (null when there are none). */
export function distribution(xs) {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((p, q) => p - q);
  if (!v.length) return null;
  const q = (p) => { const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  const r = (x) => Math.round(x * 1000) / 1000;
  return { n: v.length, min: r(v[0]), p25: r(q(0.25)), median: r(q(0.5)), p75: r(q(0.75)), max: r(v[v.length - 1]), mean: r(v.reduce((s, x) => s + x, 0) / v.length) };
}

/** Share of the finite numbers that are >= threshold (null when there are none). */
export function hitRate(xs, threshold) {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.filter((x) => x >= threshold).length / v.length : null;
}

/** Format helper for markdown tables. */
export const fmt = (x, d = 2) => (x === null || x === undefined ? "–" : typeof x === "number" ? x.toFixed(d) : String(x));
