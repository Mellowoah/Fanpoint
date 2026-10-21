/** RFC 5545 calendar export of a fill plan: anchors, fills and off/travel days as all-day events. Client-safe. */
import type { FillPlan } from "@/lib/agent/types";

/** TEXT escaping (RFC 5545 3.3.11). */
export const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

/** Fold content lines at 75 octets (RFC 5545 3.1), never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = []; let cur = ""; let n = 0; let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (n + b > limit) { out.push(cur); cur = ""; n = 0; limit = 74; }
    cur += ch; n += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const ymd = (d: string) => d.replace(/-/g, "");
const nextDay = (d: string) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export function planToIcs(q: FillPlan, stamp: Date = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const artist = q.artist.name;
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fanpoint//Tour plan//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEscape(`${artist} tour (Fanpoint)`)}`];
  let lastCity = q.anchors[0]?.city;
  for (const d of q.result.calendar) {
    const city = d.city ? `${d.city}${d.region ? `, ${d.region}` : ""}` : undefined;
    const drive = d.driveMi !== undefined ? `Drive from ${lastCity ?? "previous stop"}: ${d.driveMi} road mi${d.driveHours !== undefined ? `, ${d.driveHours} h` : ""}.` : "";
    let summary: string, desc: string;
    if (d.kind === "anchor") { summary = `${artist}: ${city}${d.label ? ` (${d.label})` : ""}`; desc = ["Confirmed show (anchor).", drive].filter(Boolean).join("\n"); }
    else if (d.kind === "fill") { summary = `${artist}: ${city} (proposed fill)`; desc = [`Proposed fill date${d.affinity !== undefined ? `, Qloo affinity ${d.affinity.toFixed(2)}` : ""}. Not confirmed: request a hold first.`, drive].filter(Boolean).join("\n"); }
    else { summary = `${artist}: off / travel day`; desc = `No show. Last show city: ${lastCity ?? "n/a"}.`; }
    L.push("BEGIN:VEVENT", `UID:${ymd(d.date)}-${d.kind}-${slug(d.city ?? "off")}-${slug(artist)}@fanpoint`, `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${ymd(d.date)}`, `DTEND;VALUE=DATE:${ymd(nextDay(d.date))}`, `SUMMARY:${icsEscape(summary)}`, `DESCRIPTION:${icsEscape(desc)}`);
    if (city) L.push(`LOCATION:${icsEscape(city)}`);
    L.push(`TRANSP:${d.kind === "off" ? "TRANSPARENT" : "OPAQUE"}`, "END:VEVENT");
    if (d.city) lastCity = d.city;
  }
  L.push("END:VCALENDAR");
  return L.map(foldLine).join("\r\n") + "\r\n";
}

export function downloadIcs(q: FillPlan) {
  const blob = new Blob([planToIcs(q)], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `${slug(q.artist.name)}-tour.ics`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
