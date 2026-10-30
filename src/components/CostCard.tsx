"use client";
import { useState } from "react";
import type { FillPlan } from "@/lib/agent/types";
import { COST_DEFAULTS, costEstimate, usd, type CostInputs } from "@/lib/client/plan-export";
import WhyPopover from "./WhyPopover";

const FIELDS: { k: keyof CostInputs; label: string; step: number; prefix?: string }[] = [
  { k: "hotelPerRoom", label: "Hotel, per room per night", step: 10, prefix: "$" },
  { k: "rooms", label: "Rooms per night", step: 1 },
  { k: "perDiem", label: "Per diem, per person", step: 5, prefix: "$" },
  { k: "crew", label: "People on the road", step: 1 },
  { k: "fuelPerMi", label: "Fuel, per road mile", step: 0.05, prefix: "$" },
];

/** Empty-night cost card: editable planning assumptions (not Qloo data) times the nights this plan filled. */
export function CostCard({ q }: { q: FillPlan }) {
  const [c, setC] = useState<CostInputs>(COST_DEFAULTS);
  const e = costEstimate(q, c);
  const edited = FIELDS.some((f) => c[f.k] !== COST_DEFAULTS[f.k]);
  return (
    <section className="card bg-panel p-4 grid gap-3 text-sm" data-cost-card aria-labelledby="cost-h">
      <div className="flex justify-between flex-wrap gap-2 items-baseline">
        <h3 id="cost-h" className="font-semibold flex items-center gap-1.5 flex-wrap"><span>What the empty nights would have cost</span>
          <span className="shrink-0"><WhyPopover label="how the cost is estimated" title="How">A night with no show still costs hotel rooms and per diems, with no show income. Each date this plan fills puts a show against those costs. Estimate = nights filled × (hotel × rooms + per diem × people), minus fuel for the extra road miles the filled route drives versus going straight between the booked shows (OSRM). The dollar amounts are your assumptions, not Qloo data; edit them to match your tour.</WhyPopover></span>
        </h3>
        <span className="text-xs text-plain">Your numbers, not Qloo data. Edit to match your tour.</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        {FIELDS.map((f) => (
          <label key={f.k} className="grid gap-1 text-xs text-plain">
            <span>{f.label}</span>
            <span className="flex items-center gap-1">{f.prefix && <span aria-hidden>{f.prefix}</span>}
              <input type="number" inputMode="decimal" min={0} step={f.step} value={c[f.k]} data-cost-input={f.k}
                onChange={(ev) => setC({ ...c, [f.k]: Math.max(0, Number(ev.target.value) || 0) })}
                className="input w-full min-w-0 font-mono text-sm text-foreground" />
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-2" aria-live="polite">
        <div><div className="text-xs text-plain">Nights filled</div><div className="font-mono text-xl font-bold" data-cost-nights>{e.nights}</div></div>
        <div><div className="text-xs text-plain">Empty-night cost ({usd(e.perNight)} a night)</div><div className="font-mono text-base">{usd(e.darkCost)}</div></div>
        <div><div className="text-xs text-plain">Extra fuel ({e.detourMi.toLocaleString("en-US")} extra road mi)</div><div className="font-mono text-base">−{usd(e.detourFuel)}</div></div>
        <div><div className="text-xs text-plain">Estimated cost avoided</div><div className="font-mono text-xl font-bold text-accent-text" data-cost-avoided>{usd(e.avoided)}</div></div>
        {edited && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setC(COST_DEFAULTS)}>Reset to defaults</button>}
      </div>
    </section>
  );
}
