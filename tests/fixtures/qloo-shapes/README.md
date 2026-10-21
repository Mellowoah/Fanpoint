# Qloo response-shape fixtures (synthetic)

Envelopes used by the parser and client tests. **Every value here is synthetic. None of it is Qloo API output or
copied from Qloo's documentation.** Names, ids, coordinates, scores and URLs are placeholders (ids are
`00000000-...`, image URLs use the reserved `example.invalid` domain). Only the **field names and nesting** follow
Qloo's public docs, so the parsers are tested against the documented shape.

| File | Shape reference (field names only) |
|---|---|
| `heatmap.json` | "Heatmaps Response Example" envelope, docs.qloo.com → API Reference → *Heatmaps use case*: `results.heatmap[]` with `location.{latitude,longitude,geohash}` and `query.{affinity,affinity_rank,popularity}`. |
| `insights-entities.json` | "Insights with location" envelope (`reference/insights-with-location-use-case.md`): `results.entities[]` with `entity_id`, `type`, `subtype`, `properties`. A movie-typed entity, because the envelope and entity fields are the same for every type. |
| `insights-artist.json` | Same envelope with the artist fields Routed reads (`popularity`, `query.affinity`, `tags`). Verify against a live response once the key arrives. |
| `search.json` | `/search` returns `{ results: [entity, ...] }` per the developer guide; field names as in the insights entity. Verify live. |
| `tags.json` | `/v2/tags` envelope (`results.tags[]` with `id`, `name`, `type`). Verify live. |

Cross-check against Qloo's harness client (`@qloo/qloo-harness` 0.1.26, MIT; read only, nothing copied). The harness reads every list as either `results` (an array) or `results.<key>`, entity ids as `entity_id` or `id`, and tag types as `type` or `subtype`. Routed's schemas accept the same variants, so these fixtures stay valid whichever envelope the live API uses. The harness confirms these request names: `/search?query=&types=&take=`, `/v2/tags?filter.query=`, and heatmaps via `/v2/insights?filter.type=urn:heatmap&signal.interests.entities=`.

Do **not** paste live API responses here: the repo is public and the Qloo hackathon FAQ allows private server-side caching only.
