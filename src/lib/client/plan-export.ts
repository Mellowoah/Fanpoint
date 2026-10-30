/** Client-safe helpers: the empty-night cost estimate and the CSV export. Deterministic, no LLM. */
import type { FillPlan } from "@/lib/agent/types";
import { holdDraft } from "./holds";
import { XD_META } from "@/lib/qloo/crossdomain";

/** Defaults the user can edit. These are planning assumptions, not Qloo data. */
export interface CostInputs { hotelPerRoom: number; rooms: number; perDiem: number; crew: number; fuelPerMi: number }
export const COST_DEFAULTS: CostInputs = { hotelPerRoom: 150, rooms: 4, perDiem: 50, crew: 6, fuelPerMi: 0.6 };

export interface CostEstimate {
  nights: number;
  /** Hotel + per diem for one night with no show. */
  perNight: number;
  /** nights × perNight. */
  darkCost: number;
  /** Extra road miles the filled route drives versus going straight between the booked shows. */
  detourMi: number;
  detourFuel: number;
  /** darkCost − detourFuel, never below 0. */
  avoided: number;
}

const n0 = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);

/** Extra miles per gap: (legs through the filled cities to the next booked show) − (direct road miles). */
export function detourMiles(q: FillPlan): number {
  const cal = q.result.calendar;
  const anchors = cal.map((d, i) => ({ d, i })).filter((x) => x.d.kind === "anchor");
  let extra = 0;
  for (let k = 0; k + 1 < anchors.length; k++) {
    const a = anchors[k]!, b = anchors[k + 1]!;
    const seg = cal.slice(a.i + 1, b.i);
    const fills = seg.filter((d) => d.kind === "fill");
    if (!fills.length) continue;
    const gap = q.result.gaps.find((g) => g.from === a.d.city && g.to === b.d.city);
    if (!gap) continue;
    const routed = fills.reduce((t, d) => t + (d.driveMi ?? 0), 0) + (b.d.driveMi ?? 0);
    extra += Math.max(0, routed - gap.directMi);
  }
  return Math.round(extra);
}

export function costEstimate(q: FillPlan, c: CostInputs): CostEstimate {
  const nights = q.stops.length;
  const perNight = n0(c.hotelPerRoom) * n0(c.rooms) + n0(c.perDiem) * n0(c.crew);
  const darkCost = nights * perNight;
  const detourMi = detourMiles(q);
  const detourFuel = Math.round(detourMi * n0(c.fuelPerMi));
  return { nights, perNight, darkCost, detourMi, detourFuel, avoided: Math.max(0, darkCost - detourFuel) };
}

export const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;

const cell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  // Quote everything that needs it; neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const CSV_HEADER = [
  "date", "day", "city", "region", "fan_strength_0_100", "rank_on_drive", "from_city", "road_mi", "drive_hours",
  "top_room", "room_address", "room_capacity", "other_rooms", "opening_act", "local_opener", "fan_neighborhoods",
  "fans_also_like", "hold_email_subject", "hold_email_body",
] as const;

export function planCsv(q: FillPlan): string {
  const rows = q.stops.map((s) => {
    const v = s.venues[0];
    const h = holdDraft(q, s);
    return [
      s.date, s.dow, s.city, s.region, Math.round(s.affinity * 100), s.rankInCorridor, s.prevCity, s.driveMi, s.driveHours,
      v?.name, v?.place?.address, v?.place?.capacity, s.venues.slice(1).map((e) => e.name).join("; "),
      q.support?.entity.name, s.support[0]?.name, (s.neighborhoods ?? []).map((n) => n.name).join("; "),
      (s.alsoLike ?? []).map((a) => `${XD_META[a.key].label}: ${a.items.map((e) => e.name).join(", ")}`).join(" | "),
      h.subject, h.body,
    ].map(cell).join(",");
  });
  return [CSV_HEADER.join(","), ...rows].join("\r\n") + "\r\n";
}

export function csvFilename(q: FillPlan): string {
  const slug = q.artist.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tour";
  return `fanpoint-${slug}-${q.stops[0]?.date ?? "plan"}.csv`;
}

export function downloadCsv(q: FillPlan) {
  const blob = new Blob(["\ufeff" + planCsv(q)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = csvFilename(q);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
