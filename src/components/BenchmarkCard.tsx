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
        <h2 id="bench-h" className="font-semibold">Fanpoint vs a plain AI chatbot <span className="text-plain font-normal">· tested on {B.acts} acts, {B.offDaysPerAct} open dates each</span></h2>
        <span className="flex items-center gap-2 text-xs text-plain">{B.note}
          <WhyPopover label="how the benchmark was measured" title="Method">
            Same booked shows for every act. Both face the same touring limits: no show too close to a booked one (radius clause), no doubling back, a daily driving cap, at most {B.maxConsecutiveShows} shows before a day off. &ldquo;Plain AI&rdquo; is the same AI model with no tools and no Qloo, answering from general knowledge. Limit breaks are counted by Fanpoint&apos;s own checker on real road distances (OSRM). &ldquo;Typical&rdquo; is the median act.{" "}
            <a className="text-accent-text underline underline-offset-2" href={METHOD_URL} target="_blank" rel="noreferrer">Full method</a>
          </WhyPopover>
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-xl border border-accent/40 bg-accent/5 p-3 grid gap-1">
          <div className="text-xs uppercase tracking-wide text-accent-text">Fanpoint + Qloo</div>
          <div><b className="text-lg font-mono">{r(B.fanpoint.nights)}</b> open dates filled <span className="text-plain">(typical: {B.fanpoint.nights.median})</span></div>
          <div><b className="font-mono">{B.fanpoint.ruleBreaks}</b> shows that broke touring limits · at most {r(B.fanpoint.longestRun)} shows before a day off</div>
        </div>
        <div className="rounded-xl border border-line bg-panel-2 p-3 grid gap-1">
          <div className="text-xs uppercase tracking-wide text-plain">Plain AI chatbot (same model, no tools)</div>
          <div><b className="text-lg font-mono">{r(p.nights)}</b> open dates filled <span className="text-plain">(typical: {p.nights.median})</span></div>
          <div>Shows too close to a booked show: {r(p.radius)} · drives that doubled back: {r(p.backtrack)} · up to <b className="font-mono">{p.longestRun.max}</b> shows without a day off <span className="text-plain">({p.actsWithBreaks} of {B.acts} plans broke a touring limit)</span></div>
        </div>
      </div>
      <div className="text-xs text-plain flex items-center gap-1.5 flex-wrap">Qloo changes which cities come first.
        <WhyPopover label="with vs without Qloo" title="Details">With and without Qloo on the same cities: the demo route fills {B.withVsWithout.demo.withQloo} of {B.withVsWithout.demo.offDays} open dates with Qloo and {B.withVsWithout.demo.withoutQloo} without (no fan data, so no schedule). On {B.withVsWithout.legs} drives, the top 5 cities by fan strength matched the top 5 by population and venues on only {B.withVsWithout.legsTop5Identical}.</WhyPopover>
      </div>
    </section>
  );
}
