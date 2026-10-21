"use client";
import { useMemo, useState } from "react";
import { MARKETS } from "@/lib/data/markets";
import type { AnchorInput, RuleOverrides } from "@/lib/agent/types";
import { RULES, RULE_VALUES } from "@/lib/touring/rules";
import { CLIENT_LIMITS, dateBounds, errorCount, hasErrors, validateFill } from "@/lib/client/fill-validate";
import { KindBadge } from "./SourcesPanel";
import ArtistInput from "./ArtistInput";
import CityInput from "./CityInput";
import HelpTip from "./HelpTip";

export interface FillFormState { artist: string; anchors: AnchorInput[]; maxDriveMi: number; minAffinity: number; rules: Required<RuleOverrides> }

export const DEFAULT_RULES: Required<RuleOverrides> = {
  maxDriveHours: RULE_VALUES.maxDriveHours, maxConsecutiveShows: RULE_VALUES.maxConsecutiveShows, radiusMi: RULE_VALUES.radiusMi,
  nightFloor: RULE_VALUES.nightFloor, dowWeights: [...RULE_VALUES.dowWeights], holidaysOff: RULE_VALUES.holidaysOff,
};
/** The fixed demo anchors (scripts/baseline/inputs.v1.json, date set "east-demo"). */
export const EAST_DEMO: AnchorInput[] = [
  { city: "New York", date: "2026-11-13", label: "Record release" },
  { city: "Durham", date: "2026-11-21", label: "Festival slot" },
  { city: "Atlanta", date: "2026-11-28", label: "Support slot" },
];
export const DEMO_FILL: FillFormState = {
  artist: "Marigold Static",
  anchors: EAST_DEMO,
  maxDriveMi: RULE_VALUES.maxDriveMi,
  minAffinity: RULE_VALUES.minAffinity,
  rules: DEFAULT_RULES,
};
/**
 * Live-mode default: a real act on the same three anchors, picked from the 2026-10-21 live baseline (most With/Without
 * divergence, then clear separation, then most fills).
 */
export const DEMO_FILL_LIVE: FillFormState = { ...DEMO_FILL, artist: "Japanese Breakfast" };
export const demoFill = (qloo: "live" | "mock" | undefined): FillFormState => (qloo === "live" ? DEMO_FILL_LIVE : DEMO_FILL);
/** Co-headliner defaults per mode (the live pair is picked from the same baseline). */
export const demoCohead = (qloo: "live" | "mock" | undefined) => (qloo === "live" ? { artist: "Black Pumas", partner: "Men I Trust" } : { artist: "Marigold Static", partner: "Saltwater Hymnal (mock)" });

/** Date sets from scripts/baseline/inputs.v1.json (tests keep them identical). */
export const DATE_SETS: Record<"east-demo" | "midwest" | "west-coast", AnchorInput[]> = {
  "east-demo": EAST_DEMO,
  midwest: [{ city: "Chicago", date: "2027-03-05" }, { city: "Minneapolis", date: "2027-03-11" }, { city: "Kansas City", date: "2027-03-18" }],
  "west-coast": [{ city: "Seattle", date: "2027-03-05" }, { city: "San Francisco", date: "2027-03-12" }, { city: "Los Angeles", date: "2027-03-18" }],
};
export interface Example { id: string; label: string; artist: string; dateSet: keyof typeof DATE_SETS }
/** "Try an example" chips: real test acts from the baseline set in live mode; the fictional demo act in mock mode. */
export function examples(qloo: "live" | "mock" | undefined): Example[] {
  if (qloo === "live") return [
    { id: "jb-east", label: "Japanese Breakfast · East run", artist: "Japanese Breakfast", dateSet: "east-demo" },
    { id: "bt-midwest", label: "Big Thief · Midwest", artist: "Big Thief", dateSet: "midwest" },
    { id: "kb-west", label: "Khruangbin · West Coast", artist: "Khruangbin", dateSet: "west-coast" },
  ];
  return [
    { id: "ms-east", label: "Marigold Static · East run", artist: "Marigold Static", dateSet: "east-demo" },
    { id: "ms-midwest", label: "Marigold Static · Midwest", artist: "Marigold Static", dateSet: "midwest" },
    { id: "ms-west", label: "Marigold Static · West Coast", artist: "Marigold Static", dateSet: "west-coast" },
  ];
}
export const exampleFill = (e: Example): FillFormState => ({ ...DEMO_FILL, artist: e.artist, anchors: DATE_SETS[e.dateSet].map((a) => ({ ...a })) });

const input = "input";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Num({ k, value, onChange, step = 1, min, max }: { k: keyof typeof RULES; value: number; onChange: (n: number) => void; step?: number; min: number; max: number }) {
  const r = RULES[k];
  const id = `rule-${k}`;
  const out = !Number.isFinite(value) || value < min || value > max;
  return (
    <div className="field">
      <span className="flex items-center gap-1.5 flex-wrap"><label htmlFor={id}>{r.label}</label> <HelpTip label={r.label}>{r.why}</HelpTip> <KindBadge kind={r.kind} /></span>
      <span className="flex items-center gap-2">
        <input id={id} type="number" inputMode="decimal" step={step} min={min} max={max} value={value} aria-invalid={out || undefined} onChange={(e) => onChange(Number(e.target.value))} className={`${input} w-28 font-mono`} />
        <span className="text-[11px] font-normal">{r.unit}</span>
      </span>
      {out && <span className="field-error">Use {min} to {max}.</span>}
    </div>
  );
}

export default function FillForm({ value, onChange, onSubmit, busy, onSources, mode, onReset }: {
  value: FillFormState; onChange: (v: FillFormState) => void; onSubmit: () => void; busy: boolean; onSources?: () => void;
  mode?: "live" | "mock"; onReset?: () => void;
}) {
  const setA = (i: number, p: Partial<AnchorInput>) => onChange({ ...value, anchors: value.anchors.map((a, k) => (k === i ? { ...a, ...p } : a)) });
  const setR = (p: Partial<RuleOverrides>) => onChange({ ...value, rules: { ...value.rules, ...p } });
  const changed = value.maxDriveMi !== RULE_VALUES.maxDriveMi || value.minAffinity !== RULE_VALUES.minAffinity || JSON.stringify(value.rules) !== JSON.stringify(DEFAULT_RULES);
  const errors = useMemo(() => validateFill(value), [value]);
  // Errors appear per field once it has been edited, and everywhere after a submit attempt.
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const show = (k: string) => attempted || seen.has(k);
  const touch = (k: string) => setSeen((s) => (s.has(k) ? s : new Set(s).add(k)));
  const bounds = useMemo(() => dateBounds(), []);
  const n = errorCount(errors);

  return (
    <form noValidate onSubmit={(e) => {
      e.preventDefault();
      if (busy) return;
      if (hasErrors(errors)) { setAttempted(true); setTimeout(() => (document.querySelector("#fill-form [aria-invalid='true']") as HTMLElement | null)?.focus(), 0); return; }
      onSubmit();
    }} id="fill-form" className="grid gap-5">
      <div className="grid gap-2">
        <ArtistInput id="artist" label="Artist" value={value.artist} placeholder="Search Qloo artists, e.g. Japanese Breakfast"
          onChange={(v) => { touch("artist"); onChange({ ...value, artist: v }); }} error={show("artist") ? errors.artist : undefined}
          hint={mode === "mock" ? "Mock mode: fictional demo acts only." : "Pick a suggestion to use the exact Qloo name."} />
        <div className="flex items-center gap-2 overflow-x-auto sm:flex-wrap -mx-4 px-4 sm:mx-0 sm:px-0 pb-1 [scrollbar-width:none]" role="group" aria-label="Try an example">
          <span className="text-[11px] text-plain mr-0.5 shrink-0">Try an example</span>
          {examples(mode).map((x) => (
            <button key={x.id} type="button" className="chip" onClick={() => { setAttempted(false); setSeen(new Set()); onChange(exampleFill(x)); }}>{x.label}</button>
          ))}
        </div>
      </div>

      <fieldset className="grid gap-2.5 min-w-0">
        <legend className="flex items-baseline justify-between gap-2 w-full mb-2.5">
          <span className="text-sm font-semibold text-foreground">Confirmed dates</span>
          <span className="text-[11px] text-plain">Festival slots, support dates, hometown shows · {MARKETS.length} U.S. markets</span>
        </legend>
        <ol className="grid md:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-2.5">
          {value.anchors.map((a, i) => {
            const e = errors.anchors[i] ?? {};
            return (
              <li key={i} className="grid gap-2 rounded-xl border border-line bg-background/60 p-3 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-semibold text-foreground"><span className="size-5 rounded-full bg-accent/15 text-accent-text grid place-items-center text-[10px]">{i + 1}</span>Stop {i + 1}</span>
                  {value.anchors.length > CLIENT_LIMITS.minAnchors && (
                    <button type="button" aria-label={`Remove stop ${i + 1}`} onClick={() => onChange({ ...value, anchors: value.anchors.filter((_, k) => k !== i) })} className="btn btn-ghost btn-sm -mr-1.5">Remove</button>
                  )}
                </div>
                <div className="grid grid-cols-1 min-[440px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-2">
                  <CityInput id={`anchor-${i}-city`} label="City" value={a.city} onChange={(c) => { touch(`city-${i}`); setA(i, { city: c }); }} error={show(`city-${i}`) ? e.city : undefined} />
                  <div className="field min-w-0">
                    <label htmlFor={`anchor-${i}-date`}>Date</label>
                    <input id={`anchor-${i}-date`} aria-label={`Anchor ${i + 1} date`} type="date" min={bounds.min} max={bounds.max} value={a.date}
                      aria-invalid={(show(`date-${i}`) && !!e.date) || undefined} aria-describedby={show(`date-${i}`) && e.date ? `anchor-${i}-date-err` : undefined}
                      onChange={(ev) => { touch(`date-${i}`); setA(i, { date: ev.target.value }); }} className={`${input} font-mono`} />
                  </div>
                </div>
                {show(`date-${i}`) && e.date && <span id={`anchor-${i}-date-err`} role="alert" className="field-error">{e.date}</span>}
                <input aria-label={`Stop ${i + 1}: what is it?`} value={a.label ?? ""} placeholder="What is it? (optional)" maxLength={40} onChange={(ev) => setA(i, { label: ev.target.value })} className={`${input} text-sm`} />
              </li>
            );
          })}
        </ol>
        {value.anchors.length < CLIENT_LIMITS.maxAnchors && (
          <button type="button" className="btn btn-ghost btn-sm justify-self-start" onClick={() => {
            const last = value.anchors[value.anchors.length - 1];
            const next = last?.date ? new Date(Date.parse(`${last.date}T12:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10) : "";
            onChange({ ...value, anchors: [...value.anchors, { city: "", date: next }] });
          }}>+ Add a stop</button>
        )}
      </fieldset>

      <details className="rounded-xl border border-line bg-background/60 p-3 sm:p-4 group">
        <summary className="cursor-pointer text-sm flex items-center gap-2 flex-wrap list-none [&::-webkit-details-marker]:hidden">
          <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" className="text-plain transition-transform group-open:rotate-90"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" /></svg>
          <span className="font-semibold">Touring rules</span>
          <span className="text-xs text-plain">≤{value.maxDriveMi} mi and ≤{value.rules.maxDriveHours} h a day · ≤{value.rules.maxConsecutiveShows} shows in a row · {value.rules.radiusMi} mi radius clause{value.rules.holidaysOff ? " · holidays off" : ""} · fan heat ≥ {Math.round(value.minAffinity * 100)}</span>
          {changed && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent-text">changed</span>}
          {onSources && <button type="button" onClick={(e) => { e.preventDefault(); onSources(); }} className="ml-auto text-xs text-accent-text underline underline-offset-2">Where these numbers come from</button>}
        </summary>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
          <Num k="maxDriveMi" value={value.maxDriveMi} min={100} max={700} step={25} onChange={(n) => onChange({ ...value, maxDriveMi: n })} />
          <Num k="maxDriveHours" value={value.rules.maxDriveHours} min={2} max={10} step={0.5} onChange={(n) => setR({ maxDriveHours: n })} />
          <Num k="maxConsecutiveShows" value={value.rules.maxConsecutiveShows} min={1} max={12} onChange={(n) => setR({ maxConsecutiveShows: n })} />
          <Num k="radiusMi" value={value.rules.radiusMi} min={0} max={300} step={5} onChange={(n) => setR({ radiusMi: n })} />
          <Num k="minAffinity" value={value.minAffinity} min={0} max={1} step={0.01} onChange={(n) => onChange({ ...value, minAffinity: n })} />
          <Num k="nightFloor" value={value.rules.nightFloor} min={0} max={0.95} step={0.05} onChange={(n) => setR({ nightFloor: n })} />
          <label className="field flex-row items-center gap-2 sm:col-span-2 lg:col-span-2">
            <input type="checkbox" checked={value.rules.holidaysOff === 1} onChange={(e) => setR({ holidaysOff: e.target.checked ? 1 : 0 })} className="size-4 accent-[var(--accent)]" />
            <span className="flex items-center gap-1.5 flex-wrap">{RULES.holidaysOff.label} <span className="text-plain font-normal">(Thanksgiving, Dec 24, Dec 25)</span> <HelpTip label={RULES.holidaysOff.label}>{RULES.holidaysOff.why}</HelpTip> <KindBadge kind={RULES.holidaysOff.kind} /></span>
          </label>
          <div className="field sm:col-span-2">
            <span className="flex items-center gap-1.5">{RULES.dowWeights.label} <HelpTip label={RULES.dowWeights.label}>{RULES.dowWeights.why}</HelpTip> <KindBadge kind={RULES.dowWeights.kind} /></span>
            <div className="grid grid-cols-7 gap-1">
              {value.rules.dowWeights.map((w, i) => (
                <label key={i} className="grid gap-0.5 text-[10px] text-center">{DOW[i]}
                  <input type="number" inputMode="decimal" step={0.05} min={0} max={1} value={w} onChange={(e) => setR({ dowWeights: value.rules.dowWeights.map((x, j) => (j === i ? Number(e.target.value) : x)) })} className={`${input} !px-1 text-center font-mono !text-xs`} />
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-3 text-xs flex-wrap items-center">
          <button type="button" onClick={() => onChange({ ...value, maxDriveMi: RULE_VALUES.maxDriveMi, minAffinity: RULE_VALUES.minAffinity, rules: DEFAULT_RULES })} className="btn btn-secondary btn-sm">Reset rules to defaults</button>
          <span className="text-plain">Amber = Fanpoint&apos;s assumption with no solid source. Change it to match your act and contracts.</span>
        </div>
      </details>

      <div className="flex items-center gap-3 flex-wrap">
        <button type="submit" disabled={busy} aria-busy={busy} className="btn btn-primary px-6 py-3 text-[15px] w-full sm:w-auto">
          {busy && <Spinner />}{busy ? "Routing…" : "Fill the gaps"}
        </button>
        {onReset && <button type="button" disabled={busy} onClick={() => { setAttempted(false); setSeen(new Set()); onReset(); }} className="btn btn-ghost">Reset</button>}
        {attempted && n > 0 && <span role="status" className="text-xs text-red-300">{n === 1 ? "One field needs a fix" : `${n} fields need a fix`} before Fanpoint can plan.</span>}
      </div>
    </form>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <svg aria-hidden className={`animate-spin ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
}
