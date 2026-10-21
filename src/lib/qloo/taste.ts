/**
 * Taste helpers shared by the server and the browser (pure). Shapes verified live on 2026-10-21:
 *   - GET /v2/analysis/compare?a.signal.interests.entities=A&b.signal.interests.entities=B -> results.tags[] with
 *     query.score. The top is sensible (Folk, Intimate, Introspective for two indie acts), but the list also has
 *     region and instrument tags and large blocks of tags tied on one score (Krautrock, Disco, Dub...).
 *   - filter.type=urn:demographics -> per entity, age-bucket and gender skews (relative to Qloo's average audience,
 *     roughly -1..1; NOT shares of the audience).
 *   - filter.type=urn:tag with signal.location -> the music genres a city's audience over-indexes on.
 */

/** A tag with a score (taste analysis affinity, or compare score). */
export interface TagScore { id: string; name: string; subtype?: string; score: number }
/** Per entity: relative skews by age bucket and gender. */
export interface Demographics { entityId: string; age: Record<string, number>; gender: Record<string, number> }

/** Tag families that describe taste. Regions, instruments and "characteristic" filler are dropped. */
const TASTE_SUBTYPES = new Set(["urn:tag:genre:music", "urn:tag:style:qloo", "urn:tag:audience:qloo", "urn:tag:theme:qloo", "urn:tag:artist:qloo", "urn:tag:music:qloo"]);
/** A block of more than this many tags tied on one score carries no ordering, so the whole block is dropped. */
export const TIE_BLOCK_MAX = 3;
export const SHARED_TAGS_SHOWN = 5;

const nameKey = (s: string) => s.trim().toLowerCase();
/** De-noised shared taste: taste subtypes only, tie blocks removed, one entry per name, highest score first. */
export function sharedTaste(tags: TagScore[], take = SHARED_TAGS_SHOWN): TagScore[] {
  const kept = tags.filter((t) => t.subtype && TASTE_SUBTYPES.has(t.subtype) && t.name.trim());
  const blocks = new Map<string, number>();
  for (const t of kept) { const k = t.score.toFixed(3); blocks.set(k, (blocks.get(k) ?? 0) + 1); }
  const seen = new Set<string>();
  return kept
    .filter((t) => (blocks.get(t.score.toFixed(3)) ?? 0) <= TIE_BLOCK_MAX)
    .sort((a, b) => b.score - a.score)
    .filter((t) => !seen.has(nameKey(t.name)) && seen.add(nameKey(t.name)))
    .slice(0, take)
    .map((t) => ({ ...t, name: t.name.trim() }));
}

const US_STATES = new Set(("alabama alaska arizona arkansas california colorado connecticut delaware florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland massachusetts michigan minnesota mississippi missouri montana nebraska nevada new_hampshire new_jersey new_mexico new_york north_carolina north_dakota ohio oklahoma oregon pennsylvania rhode_island south_carolina south_dakota tennessee texas utah vermont virginia washington west_virginia wisconsin wyoming").split(" ").map((x) => x.replace(/_/g, " ")));
/** Tidy a Qloo genre name: stray spaces around hyphens, and an all-lowercase name gets a capital ("americana"). */
const tidy = (n: string) => { const t = n.trim().replace(/\s*-\s*/g, "-").replace(/\s+/g, " "); return t === t.toLowerCase() ? t.replace(/^./, (c) => c.toUpperCase()) : t; };
/** Clean genre names for a one-line city taste profile. State-name "genres" (regional scene tags) say nothing new about a city, so they are dropped. */
export function tasteLine(tags: TagScore[], take = 5): string[] {
  const seen = new Set<string>();
  return tags.map((t) => tidy(t.name)).filter((n) => n.length > 1 && !US_STATES.has(nameKey(n)) && !seen.has(nameKey(n)) && seen.add(nameKey(n))).slice(0, take);
}

export const AGE_LABEL: Readonly<Record<string, string>> = {
  "24_and_younger": "≤24", "25_to_29": "25–29", "30_to_34": "30–34", "35_to_44": "35–44", "45_to_54": "45–54", "55_and_older": "55+",
};
export const SKEW_NOTE = "Relative skews from Qloo (vs its average audience), not shares of the audience. Positive = over-indexes.";
/** Strongest positive age skews (up to two) and the gender lean, as short labels. */
export function skewSummary(d: Demographics): { ages: string[]; gender?: string } {
  const ages = Object.entries(d.age).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => AGE_LABEL[k] ?? k);
  const [g, v] = Object.entries(d.gender).sort((a, b) => b[1] - a[1])[0] ?? [];
  return { ages, gender: g && v !== undefined && v > 0.05 ? `${g}-leaning` : undefined };
}

/** Music-only filter for artist results: keep acts that carry at least one music genre tag. */
export const isMusicAct = (tags?: { type?: string; subtype?: string }[]) => !!tags?.some((t) => (t.type ?? t.subtype ?? "").startsWith("urn:tag:genre:music"));
