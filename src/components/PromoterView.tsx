"use client";
import { useState } from "react";
import type { PromoterResponse } from "@/lib/api/promoter";
import CityInput from "./CityInput";
import { Spinner } from "./FillForm";

export const DEMO_PROMOTER_CITY = "Nashville";

/**
 * Promoter side: pick a touring city (and optionally a genre), get the acts whose fans Qloo ranks strongest there.
 * The order and scores are Qloo's (GET /api/promoter); "Plan a routing" hands the act to the agent side's Fill tool.
 */
export default function PromoterView({ onPlan, live, onSources }: { onPlan: (artist: string) => void; live: boolean; onSources: () => void }) {
  const [city, setCity] = useState(DEMO_PROMOTER_CITY);
  const [genre, setGenre] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PromoterResponse | null>(null);
  const [err, setErr] = useState<string | undefined>();

  async function run() {
    setBusy(true); setErr(undefined);
    try {
      const r = await fetch(`/api/promoter?city=${encodeURIComponent(city)}${genre.trim() ? `&genre=${encodeURIComponent(genre.trim())}` : ""}`);
      const b = (await r.json()) as PromoterResponse;
      setRes(b); if (!r.ok || b.error) setErr(b.error ?? "Qloo is unavailable right now.");
    } catch { setErr("Couldn't reach Routed. Check your connection and try again."); setRes(null); }
    setBusy(false);
  }

  return (
    <>
      <section aria-label="Promoter view" className="max-w-7xl w-full mx-auto px-4 sm:px-6 pb-6">
        <div className="card">
          <div className="flex items-center justify-between gap-3 flex-wrap border-b border-line px-4 sm:px-5 py-3">
            <h2 className="text-sm font-semibold">Promoter view</h2>
            <span className="text-xs text-plain">One city in → acts whose fans are strongest there out</span>
          </div>
          <form noValidate onSubmit={(e) => { e.preventDefault(); void run(); }} className="p-4 sm:p-5 grid md:grid-cols-[1fr_1fr_auto] gap-4 items-start">
            <CityInput id="promoter-city" label="Your city" value={city} onChange={setCity} />
            <div className="field min-w-0">
              <label htmlFor="promoter-genre">Genre (optional)</label>
              <input id="promoter-genre" className="input" value={genre} maxLength={40} placeholder={live ? "e.g. country, indie rock" : "e.g. shoegaze, dream pop"} onChange={(e) => setGenre(e.target.value)} />
              <span className="text-[11px] font-normal">Matched to a Qloo music genre tag.</span>
            </div>
            <div className="flex gap-2 md:pt-[22px]">
              <button type="submit" disabled={busy || !city.trim()} className="btn btn-primary px-6 py-[11px] w-full md:w-auto">{busy && <Spinner />}{busy ? "Finding…" : "Find acts"}</button>
            </div>
          </form>
        </div>
      </section>
      <section aria-label="Acts" className="max-w-7xl w-full mx-auto px-4 sm:px-6 grid gap-4">
        {err && <div role="alert" className="card card-pad text-sm border-red-500/40 text-red-200">{err}</div>}
        {!res && !err && (
          <div className="card card-pad grid gap-2 text-sm text-plain">
            <div className="font-semibold text-foreground">Who should you book in {city || "your city"}?</div>
            <div>Routed asks Qloo which artists&apos; fans have the strongest affinity for the city, then lets you hand any of them to the routing desk. {live ? "Real acts, live Qloo data." : "Fictional demo acts (mock mode)."} <button onClick={onSources} className="underline underline-offset-2 hover:text-foreground">Sources</button></div>
          </div>
        )}
        {res && res.acts.length > 0 && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-2.5 border-b border-line">
              <h3 className="text-sm font-semibold">Top {res.acts.length} acts for {res.city}{res.genre?.name ? ` · ${res.genre.name}` : ""}</h3>
              <span className="text-[11px] text-plain">{res.signal?.kind === "locality" ? `Qloo locality: ${res.signal.name}` : res.signal ? "Qloo location: city centre point" : ""}</span>
            </div>
            <ol className="divide-y divide-line">
              {res.acts.map((a, i) => (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <span className="w-5 text-right text-xs font-mono text-plain">{i + 1}</span>
                  {a.image ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote Qloo image, no optimizer config
                    <img src={a.image} alt="" width={44} height={44} loading="lazy" className="size-11 rounded-lg object-cover bg-background shrink-0" />
                  ) : <span aria-hidden className="size-11 rounded-lg bg-accent/15 text-accent grid place-items-center text-sm font-semibold shrink-0">{a.name.slice(0, 1)}</span>}
                  <div className="min-w-[11rem] flex-1 grid gap-0.5">
                    <div className="font-semibold truncate">{a.name}{a.mock && <span className="ml-2 text-[10px] uppercase tracking-wide text-plain">mock</span>}</div>
                    <div className="text-xs font-mono text-accent">{a.scoreLine}</div>
                    {a.detail && <div className="text-xs text-plain truncate">{a.detail}</div>}
                  </div>
                  <button onClick={() => onPlan(a.name)} className="btn btn-secondary btn-sm shrink-0 max-sm:w-full">Plan a routing</button>
                </li>
              ))}
            </ol>
            <div className="px-4 py-2.5 border-t border-line text-[11px] text-plain">Order and scores are Qloo&apos;s; Routed only removes duplicates. Scores often sit close to 1, so the rank carries more information than the two decimals.</div>
          </div>
        )}
        {res && !res.acts.length && !err && <div className="card card-pad text-sm text-plain">Qloo returned no acts for {res.city}{res.genre?.name ? ` with ${res.genre.name}` : ""}.</div>}
      </section>
    </>
  );
}
