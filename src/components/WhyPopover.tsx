"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** Collapses longer LLM text behind a small "Why?" button. Hover/focus opens on desktop, tap toggles on touch; Esc closes. */
export default function WhyPopover({ label, title = "Why?", children }: { label: string; title?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const touch = useRef(false);
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  useLayoutEffect(() => {
    const el = pop.current;
    if (!el) return;
    el.style.transform = "";
    if (!open) return;
    const r = el.getBoundingClientRect(), vw = document.documentElement.clientWidth, pad = 8;
    const dx = r.right > vw - pad ? vw - pad - r.right : r.left < pad ? pad - r.left : 0;
    if (dx) el.style.transform = `translateX(${dx}px)`;
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex align-middle" onPointerEnter={(e) => { if (e.pointerType === "mouse") setOpen(true); }} onPointerLeave={(e) => { if (e.pointerType === "mouse") setOpen(false); }}>
      <button type="button" aria-label={`${title} ${label}`} aria-expanded={open} aria-controls={id}
        onPointerDown={(e) => { touch.current = e.pointerType !== "mouse"; }}
        onClick={(e) => { e.preventDefault(); if (touch.current || e.detail === 0) setOpen((o) => !o); else setOpen(true); touch.current = false; }} onFocus={() => { if (!touch.current) setOpen(true); }} onBlur={(e) => { if (!ref.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
        className="inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[10px] leading-none text-plain hover:text-foreground hover:border-plain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <span aria-hidden className="grid size-3 place-items-center rounded-full border border-current text-[8px] font-bold">i</span>{title}
      </button>
      <div id={id} ref={pop} role="note" hidden={!open}
        className="absolute z-40 left-0 top-full mt-1.5 w-72 max-w-[calc(100vw-1rem)] rounded-lg border border-line bg-panel-2 p-3 text-xs font-normal leading-relaxed text-foreground shadow-2xl shadow-black/60 normal-case tracking-normal">
        {children}
      </div>
    </span>
  );
}
