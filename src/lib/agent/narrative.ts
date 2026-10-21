/**
 * The model may explain; it may not invent numbers. Every number in model-written text (summary, per-stop note,
 * co-headline pitch, promo angle) must match a number Fanpoint computed or read from a source, within rounding.
 * Text that fails is replaced (the deterministic explanation is always shown anyway) and the run carries a warning.
 *
 * Limits, on purpose: numbers written as words ("two") aren't parsed, and qualitative claims aren't checked; the UI
 * labels model text as AI-written so it is never mistaken for data.
 */
export interface Vetted { ok: boolean; text: string; offending: string[] }

const NUM = /(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])\d+(?:\.\d+)?/g;

/** Numbers that appear in a text, as written (commas removed). Ordinals ("1st") and ISO dates are split into parts. */
export function numbersIn(text: string): { raw: string; value: number }[] {
  return [...text.matchAll(NUM)].map((m) => ({ raw: m[0], value: Number(m[0].replace(/,/g, "")) })).filter((n) => Number.isFinite(n.value));
}

/**
 * Expand facts into the forms a writer might use: the value itself, a 0-1 score as a percentage, large counts in
 * thousands/millions, and dates as year/month/day.
 */
export function allowedForms(facts: readonly (number | string | undefined | null)[]): number[] {
  const out: number[] = [];
  for (const f of facts) {
    if (f === undefined || f === null) continue;
    if (typeof f === "string") { // ISO date or other text with numbers
      for (const n of numbersIn(f.replace(/-/g, " "))) out.push(n.value);
      continue;
    }
    if (!Number.isFinite(f)) continue;
    out.push(f);
    if (f > 0 && f <= 1) out.push(f * 100);
    if (f >= 1000) out.push(f / 1000, f / 1_000_000);
  }
  return out;
}

/** Within rounding: 0.05 absolute (one decimal place) or 1% relative, whichever is larger. */
const close = (x: number, y: number) => Math.abs(x - y) <= Math.max(0.051, Math.abs(y) * 0.01);

/** Check model text against allowed facts. Empty text passes. */
export function vetText(text: string | undefined, facts: readonly (number | string | undefined | null)[]): Vetted {
  const t = (text ?? "").trim();
  if (!t) return { ok: true, text: "", offending: [] };
  const allowed = allowedForms(facts);
  const offending = numbersIn(t).filter((n) => !allowed.some((a) => close(n.value, a))).map((n) => n.raw);
  return { ok: offending.length === 0, text: t, offending: [...new Set(offending)] };
}
