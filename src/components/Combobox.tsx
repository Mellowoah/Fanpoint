"use client";
import { useId, useRef, useState, type ReactNode } from "react";

export interface ComboOption { key: string; label: string; detail?: string; image?: string; badge?: string }

/**
 * Accessible combobox (WAI-ARIA 1.2 "list autocomplete"): the input keeps focus, ArrowUp/ArrowDown move the active
 * option, Enter picks it, Escape closes the list (a second Escape leaves the text alone). Options are given by the
 * parent, so the same widget serves the async artist search and the local city list.
 */
export default function Combobox({ id, label, value, onInput, onPick, options, status, invalid, error, hint, placeholder, onBlur, inputClassName = "", leading, autoFocusOnError, selectOnFocus }: {
  id?: string; label: ReactNode; value: string; onInput: (text: string) => void; onPick: (o: ComboOption) => void; options: ComboOption[];
  /** Shown inside the open list when there are no options, or as a footer while loading. */
  status?: string; invalid?: boolean; error?: string; hint?: ReactNode; placeholder?: string; onBlur?: () => void; inputClassName?: string; leading?: ReactNode; autoFocusOnError?: boolean; selectOnFocus?: boolean;
}) {
  const auto = useId();
  const inputId = id ?? `cb-${auto}`;
  const listId = `${inputId}-list`, errId = `${inputId}-err`, hintId = `${inputId}-hint`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const ref = useRef<HTMLInputElement>(null);
  const showList = open && (options.length > 0 || !!status);
  const pick = (o: ComboOption) => { onPick(o); setOpen(false); setActive(-1); };

  return (
    <div className="field relative min-w-0">
      <label htmlFor={inputId}>{label}</label>
      <div className="relative">
        {leading && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-plain">{leading}</span>}
        <input
          ref={ref} id={inputId} value={value} placeholder={placeholder} autoComplete="off" spellCheck={false}
          role="combobox" aria-autocomplete="list" aria-expanded={showList} aria-controls={listId}
          aria-activedescendant={showList && active >= 0 && options[active] ? `${listId}-${active}` : undefined}
          aria-invalid={invalid || !!error || undefined} aria-describedby={[error && errId, hint && hintId].filter(Boolean).join(" ") || undefined}
          autoFocus={autoFocusOnError && !!error}
          onChange={(e) => { onInput(e.target.value); setOpen(true); setActive(-1); }}
          onFocus={(e) => { setOpen(true); if (selectOnFocus) e.currentTarget.select(); }}
          onBlur={() => { setOpen(false); setActive(-1); onBlur?.(); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              if (!open) { setOpen(true); return; }
              if (!options.length) return;
              const d = e.key === "ArrowDown" ? 1 : -1;
              setActive((a) => (a + d + options.length) % options.length);
            } else if (e.key === "Enter" && showList && active >= 0 && options[active]) {
              e.preventDefault(); pick(options[active]);
            } else if (e.key === "Escape" && showList) {
              e.preventDefault(); setOpen(false); setActive(-1);
            } else if (e.key === "Tab" && showList && active >= 0 && options[active]) {
              pick(options[active]);
            }
          }}
          className={`input ${leading ? "pl-9" : ""} ${inputClassName}`}
        />
        <ul id={listId} role="listbox" aria-label={typeof label === "string" ? `${label} suggestions` : "Suggestions"} hidden={!showList}
          className="absolute z-30 left-0 right-0 mt-1.5 max-h-72 overflow-auto rounded-xl border border-line bg-panel-2 p-1 shadow-2xl shadow-black/60">
          {options.map((o, i) => (
            <li key={o.key} id={`${listId}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(o)} onMouseEnter={() => setActive(i)}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 cursor-pointer text-sm text-foreground ${i === active ? "bg-accent/15" : ""}`}>
              {o.image !== undefined && (o.image
                // eslint-disable-next-line @next/next/no-img-element -- remote thumbnail from Qloo; next/image would need a host allow-list
                ? <img src={o.image} alt="" width={28} height={28} loading="lazy" referrerPolicy="no-referrer" className="size-7 rounded-md object-cover bg-panel shrink-0" />
                : <span aria-hidden className="size-7 rounded-md bg-panel border border-line grid place-items-center text-[11px] font-semibold text-plain shrink-0">{o.label.slice(0, 1).toUpperCase()}</span>)}
              <span className="min-w-0 grid">
                <span className="truncate font-medium">{o.label}{o.badge && <span className="ml-1.5 text-[10px] font-normal text-plain">{o.badge}</span>}</span>
                {o.detail && <span className="truncate text-xs text-plain">{o.detail}</span>}
              </span>
            </li>
          ))}
          {status && <li role="presentation" className="px-2.5 py-2 text-xs text-plain">{status}</li>}
        </ul>
      </div>
      {error ? <span id={errId} className="field-error" role="alert">{error}</span> : hint ? <span id={hintId} className="text-[11px] font-normal text-plain">{hint}</span> : null}
    </div>
  );
}
