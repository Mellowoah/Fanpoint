"use client";
/** Venue, neighborhood and audience panels built from Qloo place, locality, compare and demographics data. */
import type { Entity } from "@/lib/qloo/types";
import type { RoomNote, RunSupport } from "@/lib/agent/types";
import { safeUrl, TIER_LABEL, TIER_NOTE, tierOf, type FanHood } from "@/lib/qloo/venues";
import { AGE_LABEL, SKEW_NOTE, type Demographics, type TagScore } from "@/lib/qloo/taste";
import WhyPopover from "./WhyPopover";
import { CYAN } from "./palette";

const pct = (a?: number) => (a === undefined ? "–" : `${Math.round(a * 100)}`);
const label = "text-[10px] uppercase tracking-wide text-plain";

/** The size tier a venue's Qloo category implies, with the "heuristic" caveat one tap away. */
export function TierBadge({ category, name }: { category?: string; name: string }) {
  const tier = tierOf(category);
  if (!tier) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 border border-line text-plain">{TIER_LABEL[tier]}</span>
      <WhyPopover label={`size tier for ${name}`} title="Tier">{TIER_NOTE}{category ? <> Category: <b>{category.replace(/_/g, " ")}</b>.</> : null}</WhyPopover>
    </span>
  );
}

/** One named room: fit to the artist, address, website, size tier, and a capacity only when Qloo's text states one. */
export function RoomCard({ v, note, stopCity, heading = "Top room" }: { v: Entity; note?: RoomNote; stopCity?: string; heading?: string }) {
  const p = v.place;
  const site = safeUrl(p?.website);
  const across = stopCity && v.city && v.city.toLowerCase() !== stopCity.toLowerCase();
  return (
    <div className="grid gap-1 rounded-lg border border-accent/40 bg-accent/5 p-2.5 text-sm" data-room>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={label}>{heading}</div>
          <div className="font-semibold break-words">{site ? <a href={site} target="_blank" rel="noreferrer" className="underline underline-offset-2 decoration-accent/50 hover:text-accent-text">{v.name}</a> : v.name}</div>
        </div>
        {v.affinity !== undefined && <div className="text-right shrink-0 leading-none"><div className="font-mono text-lg text-accent-text">{pct(v.affinity)}</div><div className="text-[9px] uppercase tracking-wide text-plain">Qloo fit</div></div>}
      </div>
      {p?.address && <div className="text-xs text-plain break-words">{p.address}</div>}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <TierBadge category={p?.category} name={v.name} />
        {p?.capacity && <span className="inline-flex items-center gap-1"><span>Capacity <b className="font-mono">{p.capacity.toLocaleString("en-US")}</b></span><WhyPopover label={`capacity of ${v.name}`} title="Source">Stated in Qloo&apos;s venue description: &ldquo;{p.capacityQuote}&rdquo;</WhyPopover></span>}
        {across && <span className="text-plain">in {v.city}{note?.mi !== undefined ? `, ${note.mi} mi from ${stopCity}` : ""}</span>}
        {note?.why && <WhyPopover label={`why ${v.name}`} title="Why this room">{note.why}</WhyPopover>}
      </div>
      {note?.hood && <div className="text-xs" style={{ color: CYAN }}>{note.hood.how === "named" ? "In" : `${note.hood.mi} mi from`} {note.hood.name}, a top fan neighborhood</div>}
    </div>
  );
}

/** "Fans cluster in": the top neighborhoods from Qloo's locality heatmap. */
export function FanHoods({ hoods, city }: { hoods?: FanHood[]; city: string }) {
  if (!hoods?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-hoods>
      <span className={`${label} w-14`}>Fans in</span>
      {hoods.map((h) => (
        <span key={h.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: `${CYAN}66` }}>
          <span>{h.name}{h.city && h.city.toLowerCase() !== city.toLowerCase() ? <span className="text-plain">, {h.city}</span> : null}</span><span className="font-mono" style={{ color: CYAN }}>{pct(h.affinity)}</span>
        </span>
      ))}
      <WhyPopover label={`fan neighborhoods in ${city}`} title="How">Neighborhoods near {city} where Qloo sees this artist&apos;s fans cluster most (locality heatmap, affinity 0–100). Searched within about 10 mi of the city centre; only each neighborhood&apos;s centre point is kept.</WhyPopover>
    </div>
  );
}

export function SharedTaste({ tags }: { tags?: TagScore[] }) {
  if (!tags?.length) return null;
  return (
    <div className="grid gap-1" data-shared>
      <div className={label}>Shared taste</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((t) => <span key={t.id} className="rounded-full border border-line bg-black/30 px-2 py-0.5 text-xs">{t.name}</span>)}
        <WhyPopover label="shared taste" title="How">Tags both audiences share (Qloo compare), strongest first. Fanpoint keeps genre, style and audience tags and drops regions, instruments and blocks of tags tied on one score.</WhyPopover>
      </div>
    </div>
  );
}

const AGES = Object.keys(AGE_LABEL);
const cell = (v?: number) => (v === undefined ? "–" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}`);
/** Side-by-side relative age / gender skews. */
export function SkewTable({ rows }: { rows: { name: string; color: string; d?: Demographics }[] }) {
  const have = rows.filter((r) => r.d);
  if (have.length < 2) return null;
  const tone = (v?: number) => (v === undefined || Math.abs(v) < 0.05 ? "text-plain" : v > 0 ? "text-foreground" : "text-plain/70");
  return (
    <div className="grid gap-1" data-skews>
      <div className="flex items-center gap-1.5"><span className={label}>Audience skews (relative)</span><WhyPopover label="audience skews" title="Relative">{SKEW_NOTE}</WhyPopover></div>
      <div className="overflow-x-auto">
        <table className="text-xs font-mono w-full min-w-[340px] whitespace-nowrap">
          <thead><tr className="text-plain"><th className="text-left font-normal pr-2" />{AGES.map((k) => <th key={k} className="font-normal px-1 text-right">{AGE_LABEL[k]}</th>)}<th className="font-normal px-1 text-right">F</th><th className="font-normal pl-1 text-right">M</th></tr></thead>
          <tbody>
            {have.map((r) => (
              <tr key={r.name}>
                <td className="text-left pr-2 font-sans truncate max-w-[8rem]" style={{ color: r.color }}>{r.name}</td>
                {AGES.map((k) => <td key={k} className={`px-1 text-right ${tone(r.d!.age[k])}`}>{cell(r.d!.age[k])}</td>)}
                <td className={`px-1 text-right ${tone(r.d!.gender.female)}`}>{cell(r.d!.gender.female)}</td>
                <td className={`pl-1 text-right ${tone(r.d!.gender.male)}`}>{cell(r.d!.gender.male)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The one support act for the whole run, with the taste it shares with the headliner. */
export function RunSupportCard({ s, headliner }: { s: RunSupport; headliner: string }) {
  return (
    <div className="card bg-panel p-4 grid gap-2" data-run-support>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className={label}>Support act for the whole run</div>
          <div className="text-lg font-semibold break-words">{s.entity.name}</div>
          <div className="text-xs text-plain">Opening for {headliner} on every filled date{s.stops.length ? ` · local Qloo match in ${s.stops.length} of ${s.fills} cities` : ""}</div>
        </div>
        {s.national !== undefined && <div className="text-right shrink-0 leading-none"><div className="font-mono text-lg text-accent-text">{pct(s.national)}</div><div className="text-[9px] uppercase tracking-wide text-plain">Qloo fit</div></div>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        {s.shared.map((t) => <span key={t.id} className="rounded-full border px-2 py-0.5" style={{ borderColor: `${CYAN}66` }}>{t.name}</span>)}
        {s.shared.length > 0 && <span className="text-plain">shared taste</span>}
        <WhyPopover label={`why ${s.entity.name}`} title="Why this act">{s.why} Ranked in code: most filled cities first, then national fit. Per-city alternatives are listed on each stop.</WhyPopover>
      </div>
    </div>
  );
}
