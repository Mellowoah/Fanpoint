"use client";
import { useMemo, useState } from "react";
import { findMarket } from "@/lib/data/markets";
import { cityLabel, suggestCities } from "@/lib/client/city-suggest";
import Combobox from "./Combobox";

/** Anchor city field: type-ahead over Fanpoint's market list. Stores the market name the server expects. */
export default function CityInput({ id, label, value, onChange, error }: { id?: string; label: string; value: string; onChange: (v: string) => void; error?: string }) {
  const known = findMarket(value);
  const display = known && (known.name === value) ? cityLabel(known) : value;
  const [text, setText] = useState<string | undefined>(undefined); // undefined = not editing, show the stored value
  const shown = text ?? display;
  const options = useMemo(() => (text === undefined ? [] : suggestCities(text).map((m) => ({ key: m.id, label: cityLabel(m), detail: `${m.metro.title} · metro ${(m.metro.population / 1e6).toFixed(m.metro.population >= 1e6 ? 1 : 2)}M` }))), [text]);
  return (
    <Combobox id={id} label={label} value={shown} error={error} placeholder="Start typing a city" selectOnFocus
      options={options} status={text !== undefined && !options.length ? "No touring market by that name." : undefined}
      onInput={(t) => { setText(t); onChange(t); }}
      onPick={(o) => { const m = findMarket(o.label); setText(undefined); onChange(m?.name ?? o.label); }}
      onBlur={() => { if (text !== undefined) { const m = findMarket(text); if (m) onChange(m.name); setText(undefined); } }}
    />
  );
}
