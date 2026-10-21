import { BENCHMARK as B } from "@/lib/benchmark";
import WhyPopover from "./WhyPopover";

const METHOD_URL = "https://github.com/Mellowoah/Fanpoint/blob/main/docs/DEVPOST_SUBMISSION.md#benchmark-fanpoint-vs-plain-ai";
const r = (x: { min: number; max: number }) => `${x.min}–${x.max}`;

/** Aggregate eval results only (src/lib/benchmark.ts). No per-artist data. */
export default function BenchmarkCard() {
  const p = B.plainAi;
  return (
    <section aria-labelledby="bench-h" className="card card-pad grid gap-3 text-sm" data-benchmark>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 id="bench-h" className="font-semibold">Fanpoint vs plain AI <span className="text-plain font-normal">· {B.acts} acts, {B.offDaysPerAct} open days each</span></h2>
        <span className="flex items-center gap-2 text-[11px] text-plain">{B.note}
          <WhyPopover label="how the benchmark was measured" title="Method">
            Same anchors for every act. Both modes face the same hard filters (radius clause, no backtracking, drive cap, at most {B.maxConsecutiveShows} shows in a row). Plain AI is the same LLM with no tools and no Qloo, answering from general knowledge. Rule breaks are counted by Fanpoint&apos;s own checker on OSRM road data. Fanpoint only books cities that already pass those filters.{" "}
            <a className="text-accent-text underline underline-offset-2" href={METHOD_URL} target="_blank" rel="noreferrer">Full method</a>
          </WhyPopover>
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 grid gap-1">
          <div className="text-[11px] uppercase tracking-wide text-accent-text">Fanpoint + Qloo</div>
          <div><b className="text-lg font-mono">{r(B.fanpoint.nights)}</b> nights booked <span className="text-plain">(median {B.fanpoint.nights.median})</span></div>
          <div><b className="font-mono">{B.fanpoint.ruleBreaks}</b> rule breaks · longest run {r(B.fanpoint.longestRun)} shows</div>
        </div>
        <div className="rounded-xl border border-line bg-panel-2 p-3 grid gap-1">
          <div className="text-[11px] uppercase tracking-wide text-plain">Plain AI (same LLM, no tools)</div>
          <div><b className="text-lg font-mono">{r(p.nights)}</b> nights booked <span className="text-plain">(median {p.nights.median})</span></div>
          <div>Radius breaks {r(p.radius)} · backtracking {r(p.backtrack)} · runs up to <b className="font-mono">{p.longestRun.max}</b> shows in a row <span className="text-plain">({p.actsWithBreaks} of {B.acts} plans broke a rule)</span></div>
        </div>
      </div>
      <p className="text-xs text-plain">With vs without Qloo on the same filtered cities: the demo routing books {B.withVsWithout.demo.withQloo} of {B.withVsWithout.demo.offDays} open days with Qloo and {B.withVsWithout.demo.withoutQloo} without (no fan signal, no schedule). On {B.withVsWithout.legs} legs, the Qloo top 5 matched the population/venues top 5 on only {B.withVsWithout.legsTop5Identical}.</p>
    </section>
  );
}
