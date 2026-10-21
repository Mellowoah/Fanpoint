"use client";
import { useEffect, useState, type ReactNode } from "react";
import Combobox, { type ComboOption } from "./Combobox";

interface Suggestion { id: string; name: string; detail?: string; image?: string; mock?: boolean }
interface SuggestBody { suggestions: Suggestion[]; error?: string; mode?: "live" | "mock" }

/** Client-side cache of /api/artists answers for this page session (the server caches too). */
const memo = new Map<string, SuggestBody>();
export const ARTIST_DEBOUNCE_MS = 300;
export const ARTIST_MIN_CHARS = 2;

/**
 * Artist field with Qloo-backed suggestions. Picking one sets the exact Qloo name, which is what the agent's
 * exact-match rule needs. Typing a name by hand still works.
 */
export default function ArtistInput({ id, label, value, onChange, error, hint, placeholder, autoFocusOnError }: {
  id?: string; label: ReactNode; value: string; onChange: (v: string) => void; error?: string; hint?: ReactNode; placeholder?: string; autoFocusOnError?: boolean;
}) {
  const [, setTick] = useState(0); // re-render when a fetch lands in `memo`
  const [failed, setFailed] = useState<string | undefined>();
  const [picked, setPicked] = useState<string | undefined>();
  const [touched, setTouched] = useState(false);
  const q = value.trim();
  const key = q.toLowerCase();
  const active = touched && q.length >= ARTIST_MIN_CHARS && picked !== value;
  const body = active ? memo.get(key) : undefined;

  useEffect(() => {
    if (!active || memo.has(key)) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/artists?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const b = (await res.json()) as SuggestBody;
        if (res.ok) memo.set(key, b); else setFailed(b.error ?? "Suggestions unavailable. You can still type the exact name.");
        setTick((n) => n + 1);
      } catch {
        if (!ctrl.signal.aborted) setFailed("Suggestions unavailable. You can still type the exact name.");
      }
    }, ARTIST_DEBOUNCE_MS);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [active, key, q]);

  const items = body?.suggestions ?? [];
  const status = !active ? undefined : body ? (body.error ?? (items.length ? undefined : "No matching artist. Check the spelling.")) : failed ?? "Searching…";
  const options: ComboOption[] = items.map((s) => ({ key: s.id, label: s.name, detail: s.detail, image: s.image ?? "", badge: s.mock ? "mock" : undefined }));
  return (
    <Combobox id={id} label={label} value={value} placeholder={placeholder} error={error} hint={hint} autoFocusOnError={autoFocusOnError}
      options={options} status={options.length ? undefined : status}
      onInput={(t) => { setTouched(true); setFailed(undefined); setPicked(undefined); onChange(t); }}
      onPick={(o) => { setPicked(o.label); onChange(o.label); }}
      leading={<svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>}
    />
  );
}
