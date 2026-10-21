import type { Entity, QlooRawEntity } from "./types";

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
  return {
    id: e.entity_id,
    name: e.name,
    kind: KIND[t] ?? (fallbackType ? KIND[fallbackType] ?? "other" : "other"),
    affinity: typeof e.query?.affinity === "number" ? e.query.affinity : undefined,
    popularity: typeof e.popularity === "number" ? e.popularity : undefined,
    lat: e.location?.lat,
    lon: e.location?.lon,
    city: g?.name ?? g?.city,
    region: g?.admin1_region,
    country: g?.country_code,
    description: e.properties?.short_description ?? e.properties?.description,
    tags: (e.tags ?? []).map((x) => x.name).slice(0, 6),
    mock: e._mock === true,
  };
}
