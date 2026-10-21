import type { Entity, QlooRawEntity } from "./types";
import { categoryOf, safeUrl, statedCapacity, type PlaceInfo } from "./venues";

/** Venue facts from a place record; undefined when the record carries none. */
export function placeInfo(e: QlooRawEntity): PlaceInfo | undefined {
  const p = e.properties;
  if (!p) return undefined;
  // Every free-text field a place record carries; capacity is only ever read from text that states it.
  const cap = statedCapacity([p.description, p.short_description, p.overall_description, p.physical_setting_description, p.amenities_description, p.unique_selling_points, p.ambience_description]);
  const info: PlaceInfo = {
    address: p.address?.trim() || undefined, website: safeUrl(p.website), phone: p.phone?.trim() || undefined, neighborhood: p.neighborhood?.trim() || undefined,
    category: categoryOf(p.primary_genre?.id), categoryName: p.primary_genre?.name, capacity: cap?.capacity, capacityQuote: cap?.quote,
  };
  return Object.values(info).some((v) => v !== undefined) ? info : undefined;
}

/** Map a Qloo type URN to Fanpoint's entity kind. */
const KIND: Record<string, Entity["kind"]> = {
  "urn:entity:artist": "artist",
  "urn:entity:destination": "destination",
  "urn:entity:locality": "destination",
  "urn:entity:place": "place",
  "urn:entity:brand": "brand",
  "urn:entity:podcast": "podcast",
  "urn:entity:tv_show": "tv_show",
};

/** Raw Qloo entity -> Entity. `fallbackType` is the type we asked for, used when the record has no type of its own. */
export function normalize(e: QlooRawEntity, fallbackType?: string): Entity {
  const t = e.subtype ?? e.types?.[0] ?? e.type ?? fallbackType ?? "";
  const g = e.properties?.geocode;
  const kind = KIND[t] ?? (fallbackType ? KIND[fallbackType] ?? "other" : "other");
  return {
    id: e.entity_id,
    name: e.name,
    kind,
    affinity: typeof e.query?.affinity === "number" ? e.query.affinity : undefined,
    popularity: typeof e.popularity === "number" ? e.popularity : undefined,
    lat: e.location?.lat,
    lon: e.location?.lon,
    // Places: geocode.name can be a neighborhood ("Center City"), so their city comes from geocode.city.
    city: kind === "place" ? g?.city ?? g?.name : g?.name ?? g?.city,
    region: g?.admin1_region,
    country: g?.country_code,
    description: e.properties?.short_description ?? e.properties?.description,
    tags: (e.tags ?? []).map((x) => x.name).slice(0, 6),
    place: kind === "place" ? placeInfo(e) : undefined,
    mock: e._mock === true,
  };
}
