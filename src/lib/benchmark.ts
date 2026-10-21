/**
 * Aggregate benchmark numbers only (no per-artist Qloo data).
 * Measured 2026-10-21, 10 artists, live Qloo + Gemini.
 * Fanpoint vs plain AI: baselines/live-2026-10-21-gemini/eval-final.json (`npm run eval`), 13 off days per act, heat floor 0.94.
 * With vs Without Qloo: baselines/live-2026-10-21-calibrated/baseline.json (`npm run baseline`), 20 live fill runs.
 * Both baseline folders are gitignored (Qloo terms); only these aggregates are committed.
 */
export const BENCHMARK = {
  note: "measured 2026-10-21, 10 artists, live Qloo + Gemini",
  acts: 10,
  offDaysPerAct: 13,
  fanpoint: { nights: { min: 5, max: 10, median: 7 }, ruleBreaks: 0, longestRun: { min: 3, max: 6 } },
  plainAi: {
    nights: { min: 4, max: 13, median: 5 },
    radius: { min: 0, max: 3, total: 8 },
    backtrack: { min: 0, max: 5, total: 10 },
    longestRun: { min: 1, max: 16 },
    /** Acts where the plain plan broke at least one hard rule (radius, backtrack, drive, date, or more than 6 shows in a row). */
    actsWithBreaks: 3,
  },
  withVsWithout: {
    /** The demo routing (13 off days): Fanpoint + Qloo booked 8; without fan data no schedule is built. */
    demo: { offDays: 13, withQloo: 8, withoutQloo: 0 },
    /** Legs with more than 5 eligible cities: how many With-Qloo top 5s equal the population/venues top 5. */
    legs: 34, legsTop5Identical: 2, sharedCitiesMedian: 2,
  },
  maxConsecutiveShows: 6,
} as const;
