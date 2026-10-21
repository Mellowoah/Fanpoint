/** Split run warnings: AI text hidden by the number check (narrative.ts) vs other partial-data problems. */
const NUMBER_CHECK = /^AI (?:text|promo angle|pitch) dropped for (.+?): (?:it used )?numbers not in the data/;

export interface SplitWarnings { numberCheck: string[]; other: string[]; label?: string }

export function splitWarnings(warnings: readonly string[] = []): SplitWarnings {
  const numberCheck = warnings.filter((w) => NUMBER_CHECK.test(w));
  const other = warnings.filter((w) => !NUMBER_CHECK.test(w));
  if (!numberCheck.length) return { numberCheck, other };
  const stopNotes = numberCheck.filter((w) => w.startsWith("AI text dropped for ") && !w.startsWith("AI text dropped for the summary")).length;
  const n = numberCheck.length;
  const label = stopNotes === n
    ? `AI notes hidden for ${n} stop${n === 1 ? "" : "s"} (number check)`
    : `AI text hidden in ${n} place${n === 1 ? "" : "s"} (number check)`;
  return { numberCheck, other, label };
}
