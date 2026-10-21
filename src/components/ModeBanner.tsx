export type Modes = { qloo: "live" | "mock"; llm: "live" | "mock" } | null;

export function modeLabel(m: NonNullable<Modes>): string {
  if (m.qloo === "live") return m.llm === "live" ? "LIVE QLOO · LIVE LLM" : "LIVE QLOO · MOCK LLM";
  return m.llm === "live" ? "MOCK QLOO · LIVE LLM" : "MOCK MODE";
}

export default function ModeBanner({ modes }: { modes: Modes }) {
  if (!modes) return null;
  if (modes.qloo === "live" && modes.llm === "live") {
    return (
      <div className="w-full bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-200 text-xs px-4 py-2 text-center">
        <b>{modeLabel(modes)}</b>: fan data is live from Qloo, and a real language model plans with it. Every number in a plan comes from Qloo; AI text with numbers that are not in the data is dropped.
      </div>
    );
  }
  return (
    <div className="w-full bg-amber-500/15 border-b border-amber-500/40 text-amber-200 text-xs px-4 py-2 text-center">
      <b>{modeLabel(modes)}</b>: {modes.qloo === "mock" ? "Qloo responses are fictional fixtures (names marked “(mock)”), not real Qloo data. " : "Fan data is live from Qloo. "}
      {modes.llm === "mock" ? "The LLM is a scripted stand-in: it calls the same tools in a fixed order, and its AI notes are simulated. " : "The language model is live. "}
      Set {[modes.qloo === "mock" && "QLOO_API_KEY", modes.llm === "mock" && "LLM_API_KEY"].filter(Boolean).map((k, i) => <span key={String(k)}>{i > 0 && " / "}<code className="font-mono">{k}</code></span>)} to go live.
    </div>
  );
}
