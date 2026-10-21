"use client";
import { useRef, useState } from "react";
import type { FillPlan, FillStop } from "@/lib/agent/types";
import { allHolds, holdDraft, holdMailto, holdText } from "@/lib/client/holds";
import { downloadIcs } from "@/lib/client/ics";

function useCopy() {
  const [done, setDone] = useState(false);
  return [done, async (t: string) => { try { await navigator.clipboard.writeText(t); setDone(true); setTimeout(() => setDone(false), 1600); } catch { /* clipboard blocked: text stays selectable */ } }] as const;
}

/** "Draft hold request" on a filled stop: a template email shown in a modal. Nothing is sent. */
export function HoldDraftButton({ q, s }: { q: FillPlan; s: FillStop }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, copy] = useCopy();
  const h = holdDraft(q, s);
  const id = `hold-${s.date}`;
  return (
    <>
      <button type="button" className="btn btn-secondary btn-sm justify-self-start" aria-haspopup="dialog" aria-controls={id} onClick={() => ref.current?.showModal()}>Draft hold request</button>
      <dialog ref={ref} id={id} aria-labelledby={`${id}-h`} data-hold-dialog
        className="m-auto w-[min(36rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-2rem)] rounded-2xl border border-line bg-panel p-0 text-foreground shadow-2xl backdrop:bg-black/60"
        onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}>
        <div className="grid gap-3 p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <h3 id={`${id}-h`} className="font-semibold">Hold request draft</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => ref.current?.close()} aria-label="Close">✕</button>
          </div>
          <div className="text-xs text-plain">Template built from the plan. Nothing is sent; edit it in your mail app.</div>
          <div className="grid gap-1 text-sm"><span className="eyebrow">Subject</span><div className="break-words">{h.subject}</div></div>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed rounded-lg border border-line bg-background p-3 max-h-[50dvh] overflow-auto">{h.body}</pre>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => copy(holdText(h))}>{copied ? "Copied" : "Copy"}</button>
            <a className="btn btn-secondary btn-sm" href={holdMailto(h)}>Open in email</a>
          </div>
        </div>
      </dialog>
    </>
  );
}

/** Tour-level actions: copy every hold draft, and export the plan as an .ics calendar. */
export function PlanActions({ q }: { q: FillPlan }) {
  const [copied, copy] = useCopy();
  return (
    <div className="flex flex-wrap gap-2" data-plan-actions>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadIcs(q)}>Add to calendar (.ics)</button>
      {q.stops.length > 0 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => copy(allHolds(q))}>{copied ? "Copied" : `Copy all holds (${q.stops.length})`}</button>}
    </div>
  );
}
