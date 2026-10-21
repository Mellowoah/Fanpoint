/**
 * Inline, per-field checks for the Fill form. They mirror the server's rules (api/plan-request.ts) so the user sees
 * a specific message next to the field before anything is sent; the server still validates every request.
 * Client-safe: no zod, no server modules.
 */
import { findMarket } from "../data/markets";
import { daysBetween, isIsoDate } from "../route/fill";

/** Same limits as api/plan-request.ts (a test keeps them in sync). */
export const CLIENT_LIMITS = { maxTourDays: 45, minAnchors: 2, maxAnchors: 4, artistMax: 120 } as const;

export interface AnchorDraft { city: string; date: string; label?: string }
export interface FillErrors { artist?: string; anchors: { city?: string; date?: string }[]; form?: string }

const md = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function validateFill(v: { artist: string; anchors: AnchorDraft[] }): FillErrors {
  const out: FillErrors = { anchors: v.anchors.map(() => ({})) };
  const artist = v.artist.trim();
  if (!artist) out.artist = "Enter an artist name, or pick an example below.";
  else if (artist.length > CLIENT_LIMITS.artistMax) out.artist = `Keep the name under ${CLIENT_LIMITS.artistMax} characters.`;

  const seen = new Map<string, number>();
  v.anchors.forEach((a, i) => {
    const e = out.anchors[i]!;
    const m = a.city.trim() ? findMarket(a.city) : undefined;
    if (!a.city.trim()) e.city = "Pick a city.";
    else if (!m) e.city = "Pick a city from the list.";
    else if (seen.has(m.id)) e.city = `Already used for stop ${seen.get(m.id)! + 1}.`;
    else seen.set(m.id, i);
    if (!a.date) e.date = "Pick a date.";
    else if (!isIsoDate(a.date)) e.date = "Not a real date.";
  });

  // Order and span checks only once every date is valid, so the user sees one problem at a time.
  const dates = v.anchors.map((a) => a.date);
  if (dates.every(isIsoDate)) {
    for (let i = 1; i < dates.length; i++) {
      const gap = daysBetween(dates[i - 1]!, dates[i]!);
      if (gap === 0) out.anchors[i]!.date ??= `Same day as stop ${i}. Each stop needs its own date.`;
      else if (gap < 0) out.anchors[i]!.date ??= `Before stop ${i} (${md(dates[i - 1]!)}). List stops in date order.`;
    }
    const sorted = [...dates].sort();
    const span = sorted.length > 1 ? daysBetween(sorted[0]!, sorted[sorted.length - 1]!) : 0;
    if (span > CLIENT_LIMITS.maxTourDays) {
      const last = dates.indexOf(sorted[sorted.length - 1]!);
      out.anchors[last]!.date ??= `${span} days after the first stop. Keep the run within ${CLIENT_LIMITS.maxTourDays} days.`;
    }
  }
  if (v.anchors.length < CLIENT_LIMITS.minAnchors) out.form = `Add at least ${CLIENT_LIMITS.minAnchors} confirmed stops.`;
  if (v.anchors.length > CLIENT_LIMITS.maxAnchors) out.form = `Use at most ${CLIENT_LIMITS.maxAnchors} stops.`;
  return out;
}

export const hasErrors = (e: FillErrors) => !!(e.artist || e.form || e.anchors.some((a) => a.city || a.date));
export const errorCount = (e: FillErrors) => Number(!!e.artist) + Number(!!e.form) + e.anchors.reduce((n, a) => n + Number(!!a.city) + Number(!!a.date), 0);

/**
 * Date picker bounds: one year back (so a shared link or the fixed demo dates stay valid after the show) to three
 * years ahead. Wide on purpose: they only keep the native picker near the present; the checks above are the rules.
 */
export function dateBounds(today = new Date()): { min: string; max: string } {
  const y = today.getFullYear(), mm = String(today.getMonth() + 1).padStart(2, "0"), dd = String(today.getDate()).padStart(2, "0");
  return { min: `${y - 1}-${mm}-${dd}`, max: `${y + 3}-${mm}-${dd}` };
}
