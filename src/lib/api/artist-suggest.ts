/**
 * Artist autocomplete for the form (GET /api/artists?q=). Live mode asks Qloo /search (artists only) through the
 * server-side client, so the API key never reaches the browser; mock mode suggests the fictional fixture acts.
 * Results are cached in memory (private server-side caching is allowed by Qloo's FAQ; nothing is written to disk).
 */
import "server-only";
import fixtures from "../qloo/fixtures/mock-qloo.json";
import { cacheGet, cacheSet } from "../cache";
import { isProviderError } from "../net/errors";
import { createQlooClient } from "../qloo";
import type { QlooClient } from "../qloo/types";

export interface ArtistSuggestion { id: string; name: string; detail?: string; image?: string; mock?: boolean }
export interface SuggestResponse { query: string; suggestions: ArtistSuggestion[]; mode: "live" | "mock"; error?: string }

export const SUGGEST_MIN_CHARS = 2;
export const SUGGEST_MAX_CHARS = 80;
export const SUGGEST_TAKE = 6;
/** Uncached live lookups allowed per rolling minute (protects the Qloo quota from a busy autocomplete). */
export const SUGGEST_LIVE_PER_MINUTE = 40;
const TTL_MS = 6 * 60 * 60 * 1000;

let recent: number[] = [];
/** Test helper. */
export function resetSuggestBudget() { recent = []; }

export function normalizeQuery(raw: string | null): string | undefined {
  const q = (raw ?? "").replace(/\s+/g, " ").trim();
  if (q.length < SUGGEST_MIN_CHARS || q.length > SUGGEST_MAX_CHARS || /[\u0000-\u001f\u007f]/.test(q)) return undefined;
  return q;
}

const shorten = (s?: string) => (s && s.length > 90 ? `${s.slice(0, 87).trimEnd()}…` : s);
const safeImage = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);

/** Mock suggestions: the fictional acts in the fixtures (the demo act plus the co-bill pool), prefix matches first. */
export function mockSuggestions(q: string): ArtistSuggestion[] {
  const needle = q.toLowerCase();
  const pool = [
    ...fixtures.artists.map((a) => ({ id: a.entity_id, name: a.name, detail: a.description })),
    ...fixtures.cobillPool.map((a) => ({ id: `mock-artist-${a.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}`, name: a.name, detail: `${a.tags.join(", ")} (fictional)` })),
  ];
  return pool
    .filter((a) => a.name.toLowerCase().includes(needle))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(needle)) - Number(!b.name.toLowerCase().startsWith(needle)))
    .slice(0, SUGGEST_TAKE)
    .map((a) => ({ ...a, mock: true }));
}

export async function suggestArtists(rawQuery: string | null, deps: { qloo?: QlooClient; now?: number } = {}): Promise<{ status: number; body: SuggestResponse }> {
  const q = normalizeQuery(rawQuery);
  const client = deps.qloo ?? createQlooClient();
  const mode = client.mode;
  if (!q) return { status: 200, body: { query: rawQuery ?? "", suggestions: [], mode } };
  if (mode === "mock") return { status: 200, body: { query: q, suggestions: mockSuggestions(q), mode } };

  const key = `suggest:${q.toLowerCase()}`;
  const hit = cacheGet<ArtistSuggestion[]>(key);
  if (hit) return { status: 200, body: { query: q, suggestions: hit, mode } };

  const now = deps.now ?? Date.now();
  recent = recent.filter((t) => now - t < 60_000);
  if (recent.length >= SUGGEST_LIVE_PER_MINUTE) return { status: 429, body: { query: q, suggestions: [], mode, error: "Suggestions are busy. Keep typing; the exact name still works." } };
  recent.push(now);

  try {
    const raw = await client.search(q, ["urn:entity:artist"], SUGGEST_TAKE);
    const seen = new Set<string>();
    const suggestions = raw.filter((r) => !seen.has(r.entity_id) && seen.add(r.entity_id)).slice(0, SUGGEST_TAKE).map<ArtistSuggestion>((r) => ({
      id: r.entity_id, name: r.name,
      detail: shorten(r.properties?.short_description ?? r.properties?.description),
      image: safeImage(r.properties?.image?.url),
    }));
    cacheSet(key, suggestions, TTL_MS);
    return { status: 200, body: { query: q, suggestions, mode } };
  } catch (e) {
    const msg = isProviderError(e) ? e.userMessage : "Suggestions are unavailable right now.";
    return { status: 502, body: { query: q, suggestions: [], mode, error: msg } };
  }
}
