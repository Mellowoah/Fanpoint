/** The one-line score label on every recommended city and co-headliner pair. Client-safe. */
import type { RankMode } from "./rank";

export const WITHOUT_QLOO_LINE = "No affinity signal | Ranked by population/venues only";
export const COHEAD_WITHOUT_QLOO_LINE = "No affinity signal | Unranked: without fan data the pairing can't be judged";

export function scoreLine(mode: RankMode, affinity?: number): string {
  if (mode === "without") return WITHOUT_QLOO_LINE;
  return `Qloo affinity: ${affinity === undefined ? "no reading" : affinity.toFixed(2)} | Ranked by affinity after filters`;
}
