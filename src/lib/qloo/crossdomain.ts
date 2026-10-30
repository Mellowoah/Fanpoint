/**
 * Cross-domain taste ("Fans here also like"): what this artist's fans in one city also like outside music, straight
 * from Qloo /v2/insights (signal.interests.entities = the artist, plus the city as the location signal).
 * Shared by the server (which categories to ask for) and the browser (labels). Pure data, no I/O.
 *
 * Nothing here is written by the AI: items are Qloo results in Qloo's order, and each category's "use" line is a fixed
 * plain-English suggestion of what a promoter could do with it. A category is shown only when Qloo returned results;
 * a type the hackathon key does not allow (HTTP 403) or that returns nothing is skipped for the rest of the run.
 */
import type { QlooParams } from "./types";

export type XdKey = "brands" | "podcasts" | "dining" | "tv" | "film" | "books" | "games" | "people" | "travel";

export interface XdCategory {
  key: XdKey;
  /** Short row label. */
  label: string;
  /** What a promoter could do with it (fixed text, not AI). */
  use: string;
}

/** Display order and fixed wording for every category, the two promo-hook ones (from get_city_intel) included. */
export const XD_META: Readonly<Record<XdKey, XdCategory>> = {
  brands: { key: "brands", label: "Brands", use: "sponsor or merch collab" },
  podcasts: { key: "podcasts", label: "Podcasts", use: "ad read or guest spot" },
  dining: { key: "dining", label: "Dining", use: "pre-show spot or hospitality partner" },
  tv: { key: "tv", label: "TV", use: "themed promo posts" },
  film: { key: "film", label: "Film", use: "themed promo or screening tie-in" },
  books: { key: "books", label: "Books", use: "bookstore pop-up or merch idea" },
  games: { key: "games", label: "Games", use: "promo or sponsor idea" },
  people: { key: "people", label: "People", use: "who to ask for a promo shout-out" },
  travel: { key: "travel", label: "Travel", use: "where these fans also like to go" },
};
export const XD_ORDER: readonly XdKey[] = ["brands", "podcasts", "dining", "tv", "film", "books", "games", "people", "travel"];

/** Items kept per category per city. */
export const XD_TAKE = 3;
/** Qloo's restaurant category tag (same tag family as the verified venue tags in venues.ts). */
export const DINING_TAG = "urn:tag:category:place:restaurant";
/** Tried once if the category tag returns nothing: restaurant genres (place primary_genre ids look like this). */
export const DINING_TAG_ALT = "urn:tag:genre:place:restaurant";
/**
 * Stop starting cross-domain calls once a run has made this many Qloo calls (the hard cap is 150 per run, see
 * http-client.ts). The routing and room calls are finished by then, so this only trims the extra panel.
 */
export const XD_CALL_CEILING = 135;

/** The categories that need their own Qloo call (brands and podcasts already come from get_city_intel). */
export interface XdFetch { key: Exclude<XdKey, "brands" | "podcasts">; type: string; params: (a: { artistId: string; where: string; area: QlooParams; tag?: string }) => QlooParams }
export const XD_FETCH: readonly XdFetch[] = [
  // Dining is filtered to the market area (POINT + radius, like rooms): restaurants near the stop.
  { key: "dining", type: "urn:entity:place", params: ({ artistId, area, tag }) => ({ "filter.type": "urn:entity:place", "signal.interests.entities": artistId, ...area, "filter.tags": tag ?? DINING_TAG, take: XD_TAKE + 2 }) },
  { key: "tv", type: "urn:entity:tv_show", params: ({ artistId, where }) => ({ "filter.type": "urn:entity:tv_show", "signal.interests.entities": artistId, "signal.location.query": where, take: XD_TAKE }) },
  { key: "film", type: "urn:entity:movie", params: ({ artistId, where }) => ({ "filter.type": "urn:entity:movie", "signal.interests.entities": artistId, "signal.location.query": where, take: XD_TAKE }) },
  { key: "books", type: "urn:entity:book", params: ({ artistId, where }) => ({ "filter.type": "urn:entity:book", "signal.interests.entities": artistId, "signal.location.query": where, take: XD_TAKE }) },
  { key: "games", type: "urn:entity:videogame", params: ({ artistId, where }) => ({ "filter.type": "urn:entity:videogame", "signal.interests.entities": artistId, "signal.location.query": where, take: XD_TAKE }) },
  { key: "people", type: "urn:entity:person", params: ({ artistId, where }) => ({ "filter.type": "urn:entity:person", "signal.interests.entities": artistId, "filter.exclude.entities": artistId, "signal.location.query": where, take: XD_TAKE }) },
  { key: "travel", type: "urn:entity:destination", params: ({ artistId, where }) => ({ "filter.type": "urn:entity:destination", "signal.interests.entities": artistId, "signal.location.query": where, take: XD_TAKE + 1 }) },
];

/** Brand tags that mark a fashion / apparel brand (Qloo's own tags; nothing is inferred from the name). */
const FASHION = /\b(fashion|apparel|clothing|streetwear|sneakers?|footwear|shoes?|athleisure|sportswear|denim|vintage clothing|accessories)\b/i;
export const isFashionBrand = (tags: readonly string[]) => tags.some((t) => FASHION.test(t));

/** Per-category outcome for the run (shown in the trace and in the info box). */
export type XdStatus = "data" | "empty" | "not enabled for this key" | "failed" | "skipped (call cap)";
