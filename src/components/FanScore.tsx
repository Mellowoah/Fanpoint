import type { RankMode } from "@/lib/route/rank";
import { scoreLine } from "@/lib/route/score-line";

/**
 * The score line in plain English. The exact Qloo line ("Qloo affinity: 0.95 | …") stays in the tooltip and in emails
 * and the API; on screen a judge reads "Fan strength here: 95 / 100".
 */
export function FanScore({ mode = "with", affinity, kind = "city", className = "" }: { mode?: RankMode; affinity?: number; kind?: "city" | "act"; className?: string }) {
  const n = affinity === undefined ? undefined : Math.round(affinity * 100);
  return (
    <span className={`block text-xs ${mode === "with" ? "text-accent-text" : "text-plain"} ${className}`} data-score-line title={scoreLine(mode, affinity)}>
      {mode === "without" ? "No fan data: ranked by city size and venue count only"
        : <>{kind === "city" ? "Fan strength here" : "How strongly these fans overlap"}: <b className="font-mono">{n === undefined ? "no reading" : `${n} / 100`}</b>{kind === "city" ? " · ranked by fans after the touring limits" : ""}</>}
    </span>
  );
}
