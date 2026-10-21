"use client";
import { MARKETS } from "@/lib/data/markets";
import type { AnchorInput, RuleOverrides } from "@/lib/agent/types";
import { RULES, RULE_VALUES } from "@/lib/touring/rules";
import { KindBadge } from "./SourcesPanel";

export interface FillFormState { artist: string; anchors: AnchorInput[]; maxDriveMi: number; minAffinity: number; rules: Required<RuleOverrides> }

export const DEFAULT_RULES: Required<RuleOverrides> = {
  maxDriveHours: RULE_VALUES.maxDriveHours, maxConsecutiveShows: RULE_VALUES.maxConsecutiveShows, radiusMi: RULE_VALUES.radiusMi,
  nightFloor: RULE_VALUES.nightFloor, dowWeights: [...RULE_VALUES.dowWeights],
};
export const DEMO_FILL: FillFormState = {
  artist: "Marigold Static",
  anchors: [
    { city: "New York", date: "2026-11-13", label: "Record release" },
    { city: "Durham", date: "2026-11-21", label: "Festival slot" },
    { city: "Atlanta", date: "2026-11-28", label: "Support slot" },
  ],
  maxDriveMi: RULE_VALUES.maxDriveMi,
  minAffinity: RULE_VALUES.minAffinity,
  rules: DEFAULT_RULES,
};
/**
 * Live-mode default: a real act on the same three anchors. Picked from the 2026-10-21 live baseline by a stated rule
 * (docs/DEVPOST_SUBMISSION.md, "Default demo"): most With/Without divergence, then clear separation, then most fills.
 */
export const DEMO_FILL_LIVE: FillFormState = { ...DEMO_FILL, artist: "Japanese Breakfast" };
export const demoFill = (qloo: "live" | "mock" | undefined): FillFormState => (qloo === "live" ? DEMO_FILL_LIVE : DEMO_FILL);
/** Co-headliner defaults per mode (the live pair is picked by the same baseline, see DEVPOST_SUBMISSION.md). */
export const demoCohead = (qloo: "live" | "mock" | undefined) => (qloo === "live" ? { artist: "Black Pumas", partner: "Men I Trust" } : { artist: "Marigold Static", partner: "Saltwater Hymnal (mock)" });

const cities = [...MARKETS].sort((a, b) => a.name.localeCompare(b.name));
const input = "bg-panel border border-line rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:border-accent";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Num({ k, value, onChange, step = 1, min, max }: { k: keyof typeof RULES; value: number; onChange: (n: number) => void; step?: number; min: number; max: number }) {
  const r = RULES[k];
  return (
    <label className="grid gap-1 text-xs text-plain" title={r.why}>
      <span className="flex items-center gap-1.5 flex-wrap">{r.label} <KindBadge kind={r.kind} /></span>
      <span className="flex items-center gap-1.5">
        <input type="number" step={step} min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className={`${input} w-24 font-mono`} />
        <span className="text-[10px]">{r.unit}</span>
      </span>
    </label>
  );
}

export default function FillForm({ value, onChange, onSubmit, busy, onSources }: { value: FillFormState; onChange: (v: FillFormState) => void; onSubmit: () => void; busy: boolean; onSources?: () => void }) {
  const setA = (i: number, p: Partial<AnchorInput>) => onChange({ ...value, anchors: value.anchors.map((a, k) => (k === i ? { ...a, ...p } : a)) });
  const setR = (p: Partial<RuleOverrides>) => onChange({ ...value, rules: { ...value.rules, ...p } });
  const changed = value.maxDriveMi !== RULE_VALUES.maxDriveMi || value.minAffinity !== RULE_VALUES.minAffinity || JSON.stringify(value.rules) !== JSON.stringify(DEFAULT_RULES);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="grid gap-3">
      <div className="grid sm:grid-cols-[1.4fr_auto] gap-3 items-end">
        <label className="grid gap-1 text-xs text-plain">Artist (Qloo entity)
          <input required value={value.artist} onChange={(e) => onChange({ ...value, artist: e.target.value })} className={`${input} text-base py-2.5`} />
        </label>
        <button disabled={busy} className="bg-accent text-black font-semibold rounded-lg px-5 py-2.5 disabled:opacity-50">{busy ? "Routing…" : "Fill the gaps"}</button>
      </div>
      <div className="grid gap-2">
        <div className="text-xs text-plain">Anchor dates: shows that are already confirmed (festival slots, support dates, hometown show). {cities.length} U.S. markets (Census metro areas ≥ 200k).</div>
        <div className="grid md:grid-cols-3 gap-2">
          {value.anchors.map((a, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto] gap-1.5 bg-panel/60 border border-line rounded-lg p-2">
              <select aria-label={`Anchor ${i + 1} city`} value={a.city} onChange={(e) => setA(i, { city: e.target.value })} className={input}>{cities.map((c) => <option key={c.id} value={c.name}>{c.name}{c.name.includes(",") ? "" : `, ${c.state}`}</option>)}</select>
              <input aria-label={`Anchor ${i + 1} date`} type="date" value={a.date} onChange={(e) => setA(i, { date: e.target.value })} className={`${input} [color-scheme:dark]`} />
              <input value={a.label ?? ""} placeholder="What is it?" onChange={(e) => setA(i, { label: e.target.value })} className={`${input} col-span-2 text-xs`} />
            </div>
          ))}
        </div>
      </div>
      <details className="bg-panel/60 border border-line rounded-lg p-3 group">
        <summary className="cursor-pointer text-sm flex items-center gap-2 flex-wrap">
          <span className="font-medium">Touring rules</span>
          <span className="text-xs text-plain">≤{value.maxDriveMi} mi and ≤{value.rules.maxDriveHours} h a day · ≤{value.rules.maxConsecutiveShows} shows in a row · {value.rules.radiusMi} mi radius clause · fan heat ≥ {Math.round(value.minAffinity * 100)}</span>
          {changed && <span className="text-[10px] px-1.5 rounded bg-accent/15 text-accent">changed</span>}
          {onSources && <button type="button" onClick={(e) => { e.preventDefault(); onSources(); }} className="ml-auto text-xs text-accent underline">Where these numbers come from</button>}
        </summary>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Num k="maxDriveMi" value={value.maxDriveMi} min={100} max={700} step={25} onChange={(n) => onChange({ ...value, maxDriveMi: n })} />
          <Num k="maxDriveHours" value={value.rules.maxDriveHours} min={2} max={10} step={0.5} onChange={(n) => setR({ maxDriveHours: n })} />
          <Num k="maxConsecutiveShows" value={value.rules.maxConsecutiveShows} min={1} max={12} onChange={(n) => setR({ maxConsecutiveShows: n })} />
          <Num k="radiusMi" value={value.rules.radiusMi} min={0} max={300} step={5} onChange={(n) => setR({ radiusMi: n })} />
          <Num k="minAffinity" value={value.minAffinity} min={0} max={1} step={0.01} onChange={(n) => onChange({ ...value, minAffinity: n })} />
          <Num k="nightFloor" value={value.rules.nightFloor} min={0} max={0.95} step={0.05} onChange={(n) => setR({ nightFloor: n })} />
          <div className="grid gap-1 text-xs text-plain sm:col-span-2" title={RULES.dowWeights.why}>
            <span className="flex items-center gap-1.5">{RULES.dowWeights.label} <KindBadge kind={RULES.dowWeights.kind} /></span>
            <div className="grid grid-cols-7 gap-1">
              {value.rules.dowWeights.map((w, i) => (
                <label key={i} className="grid gap-0.5 text-[10px] text-center">{DOW[i]}
                  <input type="number" step={0.05} min={0} max={1} value={w} onChange={(e) => setR({ dowWeights: value.rules.dowWeights.map((x, j) => (j === i ? Number(e.target.value) : x)) })} className={`${input} px-1 text-center font-mono`} />
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-2 text-xs">
          <button type="button" onClick={() => onChange({ ...value, maxDriveMi: RULE_VALUES.maxDriveMi, minAffinity: RULE_VALUES.minAffinity, rules: DEFAULT_RULES })} className="text-plain underline">Reset to defaults</button>
          <span className="text-plain">Amber = Routed&apos;s assumption with no solid source. Change it to match your act and contracts.</span>
        </div>
      </details>
    </form>
  );
}
