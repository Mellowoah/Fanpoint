export type Modes = { qloo: "live" | "mock"; llm: "live" | "mock" } | null;

export function modeLabel(m: NonNullable<Modes>): string {
  if (m.qloo === "live") return m.llm === "live" ? "LIVE QLOO · LIVE LLM" : "LIVE QLOO · MOCK LLM";
  return m.llm === "live" ? "MOCK QLOO · LIVE LLM" : "MOCK MODE";
}

export default function ModeBanner({ modes }: { modes: Modes }) {
  if (!modes) return null;
  if (modes.qloo === "live" && modes.llm === "live") {
    return (
      <div className="w-full bg-emerald-500/[0.08] border-b border-emerald-500/20 text-emerald-200/90 text-[11px] leading-relaxed px-4 py-1.5 text-center">
        <b>{modeLabel(modes)}</b>: fan data is live from Qloo, and a real language model plans with it. Every number in a plan comes from Qloo; AI text with numbers that are not in the data is dropped.
      </div>
    );
  }
  return (
    <div className="w-full bg-amber-500/[0.09] border-b border-amber-500/25 text-amber-200/90 text-[11px] leading-relaxed px-4 py-1.5 text-center">
      <b>{modeLabel(modes)}</b>: {modes.qloo === "mock" ? "Qloo responses are fictional fixtures (names marked “(mock)”), not real Qloo data. " : "Fan data is live from Qloo. "}
      {modes.llm === "mock" ? "The LLM is a scripted stand-in: it calls the same tools in a fixed order, and its AI notes are simulated. " : "The language model is live. "}
      Set {[modes.qloo === "mock" && "QLOO_API_KEY", modes.llm === "mock" && "LLM_API_KEY"].filter(Boolean).map((k, i) => <span key={String(k)}>{i > 0 && " / "}<code className="font-mono">{k}</code></span>)} to go live.
    </div>
  );
}

/** Compact status pill for the top nav. */
export function ModePill({ modes }: { modes: Modes }) {
  if (!modes) return <span className="hidden sm:inline-block h-6 w-20 skeleton" aria-hidden />;
  const live = modes.qloo === "live";
  return (
    <span title={modeLabel(modes)} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${live ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>
      <span className={`size-1.5 rounded-full ${live ? "bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400" : "bg-amber-400"}`} aria-hidden />
      {live ? "Live Qloo data" : "Mock mode"}
    </span>
  );
}
