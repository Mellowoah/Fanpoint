/** Deterministic hold-request drafts for filled stops. Template only: no LLM, nothing is sent. Client-safe. */
import type { FillPlan, FillStop } from "@/lib/agent/types";
import { scoreLine } from "@/lib/route/score-line";

export interface HoldDraft { subject: string; body: string }

const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const hrs = (h?: number) => (h === undefined ? "" : `, about ${h} h`);

/** The next show after `date` on the plan calendar (anchor or fill), with its road leg. */
function nextShow(q: FillPlan, date: string) {
  return q.result.calendar.find((d) => d.date > date && d.kind !== "off" && d.city);
}

export function holdDraft(q: FillPlan, s: FillStop): HoldDraft {
  const city = `${s.city}${s.region ? `, ${s.region}` : ""}`;
  const next = nextShow(q, s.date);
  const support = s.support[0]?.name;
  // The top Qloo room when there is one; the [Venue] placeholder otherwise (the user fills it in).
  const v = s.venues[0];
  const venueName = v ? v.name : "[Venue]";
  const at = v?.place?.address ? `${venueName} (${v.place.address})` : venueName;
  // A room across a city line (Camden stop, Philadelphia room) is named with its own city.
  const where = v?.city && v.city.toLowerCase() !== s.city.toLowerCase() ? `${v.city}${v.region ? `, ${v.region}` : ""} (our ${s.city} stop)` : city;
  const subject = `Hold request: ${q.artist.name}, ${v ? `${v.name}, ` : ""}${city}, ${longDate(s.date)}`;
  const lines = [
    "Hi Talent buyer,",
    "",
    `I'd like to request a hold at ${at} for ${q.artist.name} on ${longDate(s.date)} in ${where}.`,
    "",
    `Why this date: a strong fan signal in ${s.city} for ${q.artist.name} (${scoreLine("with", s.affinity)}).`,
    `Routing: coming from ${s.prevCity} (${s.driveMi} road mi${hrs(s.driveHours)})${next ? `, going on to ${next.city} (${next.driveMi ?? "?"} road mi${hrs(next.driveHours)})` : ""}.`,
  ];
  if (v) {
    const h = s.room?.hood;
    lines.push(`Why your room: it is one of the closest Qloo matches for ${q.artist.name}'s audience in the area${h ? `, ${h.how === "named" ? "in" : "near"} ${h.name}, where those fans cluster` : ""}.`);
  }
  if (support) lines.push(`Possible support: ${support}.`);
  lines.push("", "Could you let me know if the date is open and what a first or second hold would look like? Happy to share more details on the run.", "", "Thanks,", "[Your name]", "[Agency] · [Phone]");
  return { subject, body: lines.join("\n") };
}

export const holdText = (h: HoldDraft) => `Subject: ${h.subject}\n\n${h.body}`;

/** mailto: with no recipient, so the user's mail app opens a draft they fill in. */
export const holdMailto = (h: HoldDraft) => `mailto:?subject=${encodeURIComponent(h.subject)}&body=${encodeURIComponent(h.body)}`;

export function allHolds(q: FillPlan): string {
  return q.stops.map((s) => holdText(holdDraft(q, s))).join("\n\n----------\n\n");
}
