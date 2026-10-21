"use client";
import { useEffect, useId, useRef, useState } from "react";

/** Small "?" help button: opens on hover, focus or tap; Escape or a click elsewhere closes it. */
export default function HelpTip({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={`About: ${label}`} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="size-4 rounded-full border border-line text-[10px] leading-none text-plain hover:text-foreground hover:border-plain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 grid place-items-center">?</button>
      {open && (
        <span id={id} role="tooltip" className="absolute z-40 left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 max-w-[80vw] rounded-lg border border-line bg-panel-2 p-2.5 text-[11px] font-normal leading-relaxed text-foreground shadow-2xl shadow-black/60 normal-case tracking-normal">
          {children}
        </span>
      )}
    </span>
  );
}
