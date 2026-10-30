"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FillPlan, FillStop } from "@/lib/agent/types";
import {
  ADS_MANAGER, NOTICE, PLATFORMS, PLATFORM_LABEL, PLATFORM_SHORT, STATUS, VERIFY, budgetTotal, buildAdPack, charCount,
  download, packSlug, packText, packsCsv, packsJson, receipt, sourceLabel, stopInterests, usd2, type AdPack, type Platform,
} from "@/lib/client/ad-packs";
import { adCardPng, downloadDataUrl } from "@/lib/client/ad-image";
import { setAdSettings, useAdSettings } from "@/lib/client/ad-settings";
import WhyPopover from "./WhyPopover";

function useCopy() {
  const [done, setDone] = useState<string | null>(null);
  return [done, async (key: string, t: string) => { try { await navigator.clipboard.writeText(t); setDone(key); setTimeout(() => setDone(null), 1600); } catch { /* clipboard blocked: text stays selectable */ } }] as const;
}
const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export const StatusChip = () => <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-amber-400/40 bg-amber-400/10 text-amber-200 shrink-0" data-ad-status><span aria-hidden className="size-1.5 rounded-full bg-amber-300" />{STATUS}</span>;

function usePack(q: FillPlan, s: FillStop): AdPack {
  const { ticketUrl } = useAdSettings();
  return useMemo(() => buildAdPack(q, s, { ticketUrl }), [q, s, ticketUrl]);
}

/** Ticket link and budget: the user's own inputs, shared by every pack. */
function Settings({ idp }: { idp: string }) {
  const st = useAdSettings();
  const total = budgetTotal(st);
  const badUrl = st.ticketUrl.trim() !== "" && !/^https?:\/\/\S+$/i.test(st.ticketUrl.trim());
  return (
    <fieldset className="grid gap-2 rounded-lg border border-line p-3" data-ad-settings>
      <legend className="px-1 text-xs text-plain">Your numbers, not Qloo data</legend>
      <div className="grid sm:grid-cols-[minmax(0,1fr)_7rem_6rem] gap-2">
        <label className="grid gap-1 text-xs text-plain min-w-0"><span>Ticket link (optional, added to the X post)</span>
          <input type="url" inputMode="url" placeholder="https://" value={st.ticketUrl} aria-invalid={badUrl} aria-describedby={badUrl ? `${idp}-url-err` : undefined}
            onChange={(e) => setAdSettings({ ticketUrl: e.target.value })} className="input w-full min-w-0 text-sm text-foreground" data-ad-ticket /></label>
        <label className="grid gap-1 text-xs text-plain"><span>Daily budget ($)</span>
          <input type="number" min={0} step={5} inputMode="decimal" placeholder="0" value={st.daily || ""} onChange={(e) => setAdSettings({ daily: Math.max(0, Number(e.target.value) || 0) })} className="input w-full min-w-0 font-mono text-sm text-foreground" data-ad-daily /></label>
        <label className="grid gap-1 text-xs text-plain"><span>Days</span>
          <input type="number" min={1} step={1} inputMode="numeric" value={st.days || ""} onChange={(e) => setAdSettings({ days: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} className="input w-full min-w-0 font-mono text-sm text-foreground" data-ad-days /></label>
      </div>
      {badUrl && <div id={`${idp}-url-err`} className="text-xs text-red-300">Use a full link starting with https:// (left out of the post until then).</div>}
      <div className="text-xs text-plain" aria-live="polite" data-ad-budget-total>Total per platform: {total === undefined ? <span>none yet (add a daily budget)</span> : <b className="text-foreground font-mono">{usd2(total)}</b>}. Set and paid in each platform; Fanpoint spends nothing.</div>
    </fieldset>
  );
}

function Counter({ n, limit, hard }: { n: number; limit: number; hard: boolean }) {
  const over = n > limit;
  return <span className={`font-mono text-xs shrink-0 ${over ? "text-red-300" : n > limit * 0.9 ? "text-amber-200" : "text-plain"}`} aria-label={`${n} of ${limit} characters${hard ? "" : " recommended"}`}>{n}/{limit}{hard ? "" : " rec."}</span>;
}

function ImagePreview({ p, open }: { p: AdPack; open: boolean }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setSrc(adCardPng(cardText(p), 1080, 1080)), 0);
    return () => clearTimeout(t);
  }, [open, p]);
  const save = (w: number, h: number) => downloadDataUrl(`${packSlug0(p)}-${w}x${h}.png`, adCardPng(cardText(p), w, h));
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 items-start">
      {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL preview */}
      {src ? <img src={src} alt={`Placeholder ad image: ${p.artist}, ${p.city}`} width={96} height={96} className="rounded-md border border-line" /> : <div className="size-24 rounded-md skeleton" aria-hidden />}
      <div className="grid gap-1.5 text-xs text-plain min-w-0">
        <span>Placeholder card built in your browser from the plan. Replace with your artwork before launch.</span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => save(1080, 1080)} data-ad-img="1080x1080">PNG 1080×1080</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => save(1080, 1920)} data-ad-img="1080x1920">PNG 1080×1920</button>
        </div>
      </div>
    </div>
  );
}
const cardText = (p: AdPack) => ({ artist: p.artist, city: p.city, date: longDate(p.date), venue: p.venue, hook: p.hook?.name });
const packSlug0 = (p: AdPack) => `fanpoint-ad-${`${p.artist}-${p.city}-${p.date}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

function PlatformPanel({ p, pl, copied, copy }: { p: AdPack; pl: Platform; copied: string | null; copy: (k: string, t: string) => void }) {
  const a = p.audience;
  return (
    <div className="grid gap-4">
      <section className="grid gap-2" aria-label={`${PLATFORM_SHORT[pl]} audience`}>
        <h4 className="eyebrow">Audience</h4>
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1 text-sm">
          <dt className="text-plain text-xs pt-0.5">Location</dt><dd className="min-w-0 break-words">{a.location.label} <span className="text-plain text-xs font-mono">({a.location.lat}, {a.location.lon})</span></dd>
          <dt className="text-plain text-xs pt-0.5">Dates</dt><dd>{shortDate(a.start)} – {longDate(a.end)} <span className="text-plain text-xs">(14 days up to the show)</span></dd>
          <dt className="text-plain text-xs pt-0.5">Ages</dt><dd>{a.minAge}+</dd>
        </dl>
        <div className="flex items-center gap-1.5 flex-wrap text-xs text-plain">
          <span className="font-semibold text-foreground text-sm">Interests</span>
          <span>from Qloo taste data for this city&apos;s fans · {VERIFY}</span>
          <WhyPopover label="how interests are picked" title="How" wide>
            Each interest is a Qloo result already in this plan: what this artist&apos;s fans in {p.city} also like (cross-domain taste: brands, podcasts, TV, film, books, games, people), the promo picks and the local opener, strongest Qloo affinity first. Picked and mapped in code, not by the AI. Qloo data is aggregate taste for an audience, not a list of people. Platform interest names can&apos;t be checked without each platform&apos;s ads API, so search each one in Ads Manager and pick the closest match. Sensitive topics (politics, religion, health, sexuality, race or ethnicity, personal finances) and age-restricted products are never used.
          </WhyPopover>
        </div>
        <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-1" data-ad-interests={pl}>
          {a.interests.map((i) => (
            <li key={i.entityId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0 text-sm" data-ad-interest={i.entityId}>
              <span className="font-medium min-w-0 break-words">{i.platform[pl]}</span>
              <span className="text-xs text-plain min-w-0 break-words" data-ad-receipt title={`Qloo entity ${i.entityId}`}>{i.source === "music" ? "your artist" : `${sourceLabel(i.source)}${i.rank ? ` #${i.rank}` : ""}`}{i.affinity !== undefined && <> · <span className="font-mono text-accent-text">{i.affinity}</span></>}</span>
            </li>
          ))}
        </ul>
        {a.excluded.length > 0 && <div className="text-xs text-plain" data-ad-excluded>Left out on purpose: {a.excluded.map((e) => `${e.name} (${e.reason})`).join(", ")}.</div>}
        {pl === "meta" && a.localPartners.length > 0 && <div className="text-xs text-plain">Local partner ideas (not targeting): {a.localPartners.join(", ")}.</div>}
      </section>

      <section className="grid gap-2" aria-label={`${PLATFORM_SHORT[pl]} creative`}>
        <h4 className="eyebrow">Creative</h4>
        {p.creative[pl].map((c) => {
          const n = charCount(c.text, pl), key = `${pl}-${c.field}`;
          return (
            <div key={c.field} className="grid gap-1" data-ad-field={key}>
              <div className="flex items-center justify-between gap-2 text-xs"><span className="text-plain">{c.field}</span><span className="flex items-center gap-2"><Counter n={n} limit={c.limit} hard={c.hard} /><button type="button" className="btn btn-ghost btn-sm !py-0.5" onClick={() => copy(key, c.text)} aria-label={`Copy ${PLATFORM_SHORT[pl]} ${c.field}`}>{copied === key ? "Copied" : "Copy"}</button></span></div>
              <p className="rounded-lg border border-line bg-background px-3 py-2 text-sm break-words whitespace-pre-wrap">{c.text}</p>
            </div>
          );
        })}
        <div className="text-xs text-plain">Call to action: <span className="text-foreground">{p.cta[pl]}</span> · Template text from the plan, no AI. Hook: {p.hook ? <>&ldquo;{p.hook.name}&rdquo; ({receipt(p.hook)})</> : "none (no Qloo cross-domain pick for this city)"}.</div>
        {p.aiAngle && pl === "meta" && <div className="text-xs flex items-center gap-1.5 flex-wrap"><span className="px-1.5 py-0.5 rounded bg-white/5 border border-line text-plain" title="Written by the AI; every number in it was checked against the data">AI</span><span className="text-plain">Promo idea from the plan for {p.aiAngle.name}:</span><WhyPopover label={`AI promo idea: ${p.aiAngle.name}`} title="Read">{p.aiAngle.text}</WhyPopover></div>}
      </section>

      <section className="grid gap-2" aria-label={`${PLATFORM_SHORT[pl]} image`}>
        <h4 className="eyebrow">Image</h4>
        <div className="text-xs text-plain">Sizes: {p.images[pl].join(" · ")}</div>
      </section>

      <div className="flex flex-wrap gap-2">
        <a className="btn btn-primary btn-sm" href={ADS_MANAGER[pl]} target="_blank" rel="noopener noreferrer" data-ad-open={pl}>Open {pl === "meta" ? "Meta Ads Manager" : pl === "x" ? "X Ads" : "Snapchat Ads Manager"}<span className="sr-only"> (opens in a new tab)</span> ↗</a>
        {pl === "x" && <a className="btn btn-secondary btn-sm" href={p.xIntent} target="_blank" rel="noopener noreferrer" data-ad-x-intent>Post on X (organic, you press Post)<span className="sr-only"> (opens in a new tab)</span> ↗</a>}
      </div>
    </div>
  );
}

/** Per stop: "Ad launch pack" button and its dialog with Meta / X / Snapchat tabs. Nothing is posted or spent. */
export function AdPackButton({ q, s }: { q: FillPlan; s: FillStop }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Platform>("meta");
  const [copied, copy] = useCopy();
  const p = usePack(q, s);
  const st = useAdSettings();
  const id = `ads-${s.date}`;
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? PLATFORMS.length - 1 : null;
    if (n === null) return;
    e.preventDefault();
    const k = (n + PLATFORMS.length) % PLATFORMS.length;
    setTab(PLATFORMS[k]!); tabs.current[k]?.focus();
  };
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm w-fit" aria-haspopup="dialog" aria-controls={id} data-ad-pack-open={s.date} onClick={() => { ref.current?.showModal(); setOpen(true); }}>Ad launch pack <span className="text-plain">· Meta, X, Snapchat</span></button>
      <dialog ref={ref} id={id} aria-labelledby={`${id}-h`} data-ad-dialog
        className="m-auto w-[min(44rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] rounded-2xl border border-line bg-panel p-0 text-foreground shadow-2xl backdrop:bg-black/60"
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
        <div className="grid gap-3 p-4 sm:p-5 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="grid gap-1 min-w-0">
              <h3 id={`${id}-h`} className="font-semibold break-words">Ad launch pack · {p.city} · {longDate(s.date)}</h3>
              <div className="flex flex-wrap items-center gap-2"><StatusChip /><span className="text-xs text-plain break-words">{p.artist}{p.venue ? ` at ${p.venue}` : ""}</span></div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => ref.current?.close()} aria-label="Close">✕</button>
          </div>
          <p className="text-sm rounded-lg border border-accent/30 bg-accent/10 px-3 py-2" data-ad-notice>{NOTICE}</p>
          <div role="tablist" aria-label="Ad platform" className="seg w-full overflow-x-auto">
            {PLATFORMS.map((pl, i) => (
              <button key={pl} ref={(el) => { tabs.current[i] = el; }} role="tab" id={`${id}-tab-${pl}`} aria-selected={tab === pl} aria-controls={`${id}-panel`} tabIndex={tab === pl ? 0 : -1}
                onClick={() => setTab(pl)} onKeyDown={(e) => onKey(e, i)} data-ad-tab={pl}>{pl === "meta" ? <><span className="sm:hidden">Meta</span><span className="hidden sm:inline">{PLATFORM_LABEL.meta}</span></> : PLATFORM_LABEL[pl]}</button>
            ))}
          </div>
          <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${tab}`} tabIndex={0} className="min-w-0 outline-none" data-ad-panel={tab}>
            <PlatformPanel p={p} pl={tab} copied={copied} copy={copy} />
          </div>
          <ImagePreview p={p} open={open} />
          <Settings idp={id} />
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <button type="button" className="btn btn-primary btn-sm" data-ad-copy-all onClick={() => copy("all", packText(p, st))}>{copied === "all" ? "Copied" : "Copy all (3 platforms)"}</button>
            <button type="button" className="btn btn-secondary btn-sm" data-ad-dl-json onClick={() => download(`${packSlug(q, s)}.json`, packsJson([p], st), "application/json")}>Download .json</button>
            <button type="button" className="btn btn-secondary btn-sm" data-ad-dl-csv onClick={() => download(`${packSlug(q, s)}.csv`, packsCsv([p], st), "text/csv;charset=utf-8")}>Download .csv</button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** Tour level: what the packs are, the approval gate, and one-click downloads of every stop's pack. */
export function AdPacksCard({ q }: { q: FillPlan }) {
  const st = useAdSettings();
  const packs = useMemo(() => q.stops.map((s) => buildAdPack(q, s, { ticketUrl: st.ticketUrl })), [q, st.ticketUrl]);
  if (!q.stops.length) return null;
  const n = packs.reduce((t, p) => t + p.audience.interests.length, 0);
  return (
    <section className="card bg-panel p-4 grid gap-3 text-sm" data-ad-packs-card aria-labelledby="ads-h">
      <div className="flex justify-between flex-wrap gap-2 items-center">
        <h3 id="ads-h" className="font-semibold flex items-center gap-1.5 flex-wrap"><span>Ad launch packs</span><span className="text-plain font-normal">· Meta (Facebook + Instagram), X, Snapchat</span>
          <WhyPopover label="ad launch packs" title="What is this" wide>
            For every filled date: a location and date window around the room, ages 18+, interests drawn from Qloo taste data for that city&apos;s fans (each with its Qloo source), and ad copy sized to each platform&apos;s limits. Built in your browser from this plan, with no AI call and no ads-platform account. Real campaigns need your own ad account on each platform: open the pack, then launch there after review. Qloo data is aggregate taste for an audience, not a list of people, and no reach or cost estimates are given.
          </WhyPopover>
        </h3>
        <StatusChip />
      </div>
      <p className="text-plain">{NOTICE} <span className="text-foreground">{packs.length} packs · {n} Qloo-sourced interests.</span></p>
      <div className="flex flex-wrap gap-2" data-ad-stops>
        {q.stops.map((s) => <button key={s.date} type="button" className="btn btn-ghost btn-sm border border-line" onClick={() => (document.getElementById(`ads-${s.date}`) as HTMLDialogElement | null)?.showModal()} data-ad-stop={s.date}>{s.city.replace(/,.*$/, "")} · {shortDate(s.date)}</button>)}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" data-ad-dl-all-csv onClick={() => download(`${packSlug(q)}.csv`, packsCsv(packs, st), "text/csv;charset=utf-8")}>Download all stops (.csv)</button>
        <button type="button" className="btn btn-secondary btn-sm" data-ad-dl-all-json onClick={() => download(`${packSlug(q)}.json`, packsJson(packs, st), "application/json")}>Download all stops (.json)</button>
      </div>
    </section>
  );
}

/** Inside Receipts: the Qloo source of every ad interest, stop by stop. */
export function AdReceipts({ q }: { q: FillPlan }) {
  if (!q.stops.length) return null;
  return (
    <div className="grid gap-2 mt-4 min-w-0" data-ad-receipts>
      <h4 className="text-sm font-semibold">Ad launch packs: where every interest came from</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[26rem]">
          <thead className="text-plain text-left"><tr><th className="py-1 pr-2 font-normal">Interest</th><th className="py-1 pr-2 font-normal">Qloo category</th><th className="py-1 pr-2 font-normal">Rank</th><th className="py-1 pr-2 font-normal">Affinity</th><th className="py-1 font-normal">Qloo id</th></tr></thead>
          <tbody>
            {q.stops.flatMap((s) => {
              const { interests, excluded } = stopInterests(q, s);
              return [
                <tr key={`${s.date}-h`} className="border-t border-line"><th colSpan={5} scope="colgroup" className="pt-2 pb-1 text-left font-semibold text-foreground">{s.city.replace(/,.*$/, "")} · {shortDate(s.date)}</th></tr>,
                ...interests.map((i) => <tr key={`${s.date}-${i.entityId}`} className="border-t border-line/60"><td className="py-1 pr-2 break-words">{i.name}</td><td className="py-1 pr-2">{sourceLabel(i.source)}</td><td className="py-1 pr-2 font-mono">{i.rank ?? "–"}</td><td className="py-1 pr-2 font-mono">{i.affinity ?? "–"}</td><td className="py-1 font-mono text-plain break-all">{i.entityId}</td></tr>),
                ...excluded.map((e) => <tr key={`${s.date}-x-${e.entityId}`} className="border-t border-line/60 text-plain"><td className="py-1 pr-2 line-through">{e.name}</td><td className="py-1 pr-2" colSpan={3}>left out: {e.reason}</td><td className="py-1 font-mono break-all">{e.entityId}</td></tr>),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
