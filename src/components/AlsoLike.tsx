"use client";
import type { Entity } from "@/lib/qloo/types";
import type { CrossDomainReport, FillStop } from "@/lib/agent/types";
import { isFashionBrand, XD_META, XD_ORDER, type XdKey } from "@/lib/qloo/crossdomain";
import WhyPopover from "./WhyPopover";
import { sponsorHooks } from "@/lib/client/sponsor-hooks";

const pct = (a?: number) => (a === undefined ? undefined : `${Math.round(a * 100)}`);
/** Items per category on a stop card (the data keeps up to XD_TAKE), and rows shown before "More". */
const SHOWN = 2, VISIBLE_ROWS = 3;
const PROMO_KIND: Record<string, string> = { brand: "Brand", podcast: "Podcast", tv_show: "TV" };

function Pick({ e, extra }: { e: Entity; extra?: React.ReactNode }) {
  const n = pct(e.affinity);
  return (
    <span className="inline-flex items-center gap-1 bg-black/30 border border-line rounded-full px-2 py-0.5 text-xs" title={n ? "Number = how strongly this matches these fans, 0–100 (Qloo)" : undefined}>
      <span className="break-words">{e.name}</span>
      {e.kind === "brand" && isFashionBrand(e.tags) && <span className="text-plain">· fashion</span>}
      {extra}
      {n && <span className="text-accent-text font-mono shrink-0">{n}</span>}
    </span>
  );
}

/** Categories that came back empty or were not allowed, so the info box says what was asked but not shown. */
function missing(status?: CrossDomainReport["status"]): string {
  if (!status) return "";
  const out = XD_ORDER.filter((k) => status[k] && status[k] !== "data").map((k) => `${XD_META[k].label} (${status[k] === "empty" ? "no results" : status[k]})`);
  return out.length ? ` Asked but not shown this run: ${out.join(", ")}.` : "";
}

/** Per stop: what this city's fans of the artist also like outside music (Qloo cross-domain taste). */
export function AlsoLikePanel({ s, artist, status }: { s: FillStop; artist: string; status?: CrossDomainReport["status"] }) {
  const promoKinds = new Set<XdKey>(s.promo.map((p) => (p.entity.kind === "podcast" ? "podcasts" : "brands")));
  // Brands and podcasts already shown as promo ideas are not repeated (the tour card lists the rest).
  const rows = (s.alsoLike ?? []).filter((r) => !promoKinds.has(r.key)).map((r) => ({ ...r, items: r.items.slice(0, SHOWN) }));
  if (!s.promo.length && !rows.length) return null;

  // Sponsor & Ad Opportunities: the brand/podcast promo ideas and cross-domain picks, deduped, strongest first.
  // Shown once: items here are not repeated in the promo lines or the rows below.
  const hooks = sponsorHooks(s);
  const hookIds = new Set(hooks.map((h) => h.entity.id));
  const promoRest = s.promo.filter((p) => !hookIds.has(p.entity.id));
  const rowsShown = rows.map((r) => ({ ...r, items: r.items.filter((e) => !hookIds.has(e.id)) })).filter((r) => r.items.length);
  const topShown = rowsShown.slice(0, VISIBLE_ROWS), moreShown = rowsShown.slice(VISIBLE_ROWS);

  return (
    <section className="grid gap-1.5 border-t border-line pt-2 min-w-0" data-also-like aria-label={`What ${artist} fans in ${s.city} also like`}>
      {/* Prominent Sponsor & Ad Opportunities */}
      {hooks.length > 0 && (
        <div className="bg-accent/10 border border-accent/30 rounded-md p-2.5 grid gap-1.5" data-sponsor-hooks>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-semibold text-accent-text">Sponsor &amp; Ad Opportunities</span>
            <WhyPopover label="sponsor and ad hooks from taste data" title="What is this">
              Brands and podcasts that {artist}&apos;s fans in {s.city} also like, from Qloo cross-domain taste data, strongest match first (number = how strongly it matches these fans, 0–100). Names are Qloo results picked in code. Lines marked AI are AI-written promo ideas (numbers checked against the data); the others are Fanpoint&apos;s fixed suggestion for how to use the pick. Ideas for outreach, not confirmed partnerships.
            </WhyPopover>
          </div>
          {hooks.map((h) => (
            <div key={h.entity.id} className="text-sm flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0" data-sponsor-hook={h.entity.id}>
              <span className="text-xs px-1.5 rounded bg-accent text-white shrink-0">{PROMO_KIND[h.entity.kind] ?? h.entity.kind}{h.entity.kind === "brand" && isFashionBrand(h.entity.tags) ? " · fashion" : ""}</span>
              <span className="min-w-0 break-words font-medium">{h.entity.name}</span>
              {pct(h.entity.affinity) && <span className="text-xs text-accent-text font-mono shrink-0" title="How strongly this matches these fans, 0–100 (Qloo)">{pct(h.entity.affinity)}</span>}
              {h.angleBy === "ai"
                ? <WhyPopover label={`promo idea: ${h.entity.name}`} title="Promo idea (AI)">{h.angle}</WhyPopover>
                : <span className="text-xs text-plain min-w-0 break-words">· {h.angle}</span>}
            </div>
          ))}
        </div>
      )}

      {(promoRest.length > 0 || rowsShown.length > 0) && <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs font-semibold text-foreground">Fans here also like</span>
        <WhyPopover label={`what fans in ${s.city} also like`} title="What is this">
          Qloo cross-domain taste data: what {artist}&apos;s fans in {s.city} also like outside music, strongest match first (number = how strongly it matches these fans, 0–100).
          Every name is a Qloo result, picked in code, not by the AI. Only the promo ideas marked &quot;AI&quot; are AI-written (their numbers are checked against the data). The note on each row is Fanpoint&apos;s fixed suggestion for how a promoter could use it, not a deal or a partnership.
          A category appears only when Qloo returned results for it.{missing(status)}
        </WhyPopover>
      </div>
      {promoRest.map((p) => (
        <div key={p.entity.id} className="text-sm flex gap-2 min-w-0">
          <span className="text-xs mt-0.5 px-1.5 rounded bg-accent/15 text-accent-text h-fit shrink-0">{PROMO_KIND[p.entity.kind] ?? p.entity.kind}{p.entity.kind === "brand" && isFashionBrand(p.entity.tags) ? " · fashion" : ""}</span>
          {p.angleBy === "ai"
            ? <span className="flex items-center gap-1.5 flex-wrap"><span>{p.entity.name}</span><WhyPopover label={`promo idea: ${p.entity.name}`} title="Promo idea (AI)">{p.angle}</WhyPopover></span>
            : <span className="min-w-0 break-words">{p.angle}</span>}
        </div>
      ))}
      {topShown.map((r) => <Row key={r.key} r={r} />)}
      {moreShown.length > 0 && (
        <details className="group min-w-0">
          <summary className="cursor-pointer text-xs text-plain hover:text-foreground list-none">
            <span className="group-open:hidden">+ More they like: {moreShown.map((r) => XD_META[r.key].label.toLowerCase()).join(", ")}</span>
            <span className="hidden group-open:inline">− Show less</span>
          </summary>
          <div className="grid gap-1.5 mt-1.5">{moreShown.map((r) => <Row key={r.key} r={r} />)}</div>
        </details>
      )}
      </>}
    </section>
  );
}

function Row({ r }: { r: { key: XdKey; items: Entity[] } }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 items-start min-w-0" data-also-like-row={r.key}>
      <span className="text-xs text-plain pt-0.5">{XD_META[r.key].label}</span>
      <div className="flex flex-wrap items-center gap-1 min-w-0">
        {r.items.map((e) => <Pick key={e.id} e={e} />)}
        <span className="text-xs text-plain basis-full">{XD_META[r.key].use}</span>
      </div>
    </div>
  );
}

/** Tour-wide: picks Qloo listed for these fans in two or more filled cities. */
export function TourAlsoLikeCard({ x, artist, stops }: { x?: CrossDomainReport; artist: string; stops: number }) {
  if (!x?.tour.length) return null;
  return (
    <div className="card bg-panel p-4 grid gap-2 min-w-0" data-tour-also-like>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-plain">Across the tour</span>
        <WhyPopover label="what fans across the tour also like" title="What is this" wide>
          Qloo cross-domain taste data for {artist}&apos;s fans, city by city. Listed here: picks that came up in two or more of the {stops} cities we filled, so one sponsor, podcast or promo theme can cover several dates.
          Every name is a Qloo result; nothing here is written by the AI.{missing(x.status)}
        </WhyPopover>
      </div>
      <div className="text-lg font-semibold">What these fans also like, on more than one date</div>
      {x.tour.map((r) => (
        <div key={r.key} className="flex flex-wrap items-center gap-1.5 min-w-0" data-tour-row={r.key}>
          <span className="text-xs text-plain w-20 shrink-0">{XD_META[r.key].label}</span>
          {r.items.map((i) => <Pick key={i.entity.id} e={{ ...i.entity, affinity: undefined }} extra={<span className="text-plain" title={i.cities.join(", ")}>· {i.cities.length} cities</span>} />)}
          <span className="text-xs text-plain">{XD_META[r.key].use}</span>
        </div>
      ))}
    </div>
  );
}
