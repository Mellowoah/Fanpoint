# Sources & methodology

Fanpoint makes its decisions in code, from the data and rules listed here. The LLM chooses which tool to call next and
writes plain-language notes. It does not choose cities, dates, support acts, rooms, promo partners or recommended
co-headliners, and any number in its text must match a number Fanpoint computed or read from a source. If one doesn't,
the text is dropped and the run shows a warning (`src/lib/agent/narrative.ts`).

The UI's **Sources & methodology** panel renders the same registry (`src/lib/touring/rules.ts`). `tests/data.test.ts`
fails if a rule in that file has no entry here.

Each rule has one of four statuses:

- **Sourced**: the default value comes from a cited source.
- **Adapted**: a cited source exists, but for a neighbouring context.
- **Assumption**: Fanpoint's own default with no solid source. It is labelled as an assumption in the UI. The ones marked
  adjustable can be changed in the form; the rest are set in `rules.ts`.
- **Implementation detail**: breaks ties or bounds the work; it doesn't state anything about touring.

## Data

| Data | Used for | License / terms | Version |
|---|---|---|---|
| [Qloo Taste AI™ Insights API](https://docs.qloo.com/) | Fan affinity heatmaps, corridor ranks, support acts, rooms, brands, podcasts, peer acts. **The only source of taste signals.** | Qloo API terms; the key stays server-side | Live, per request |
| [OSRM](https://project-osrm.org/) road routing (car profile) on [OpenStreetMap](https://www.openstreetmap.org/copyright) | Road miles and drive hours for every ordered pair of the 385 markets (148,225 pairs) | OSM data © OpenStreetMap contributors, [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). OSRM is BSD-2-Clause. Demo-server [usage policy](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server). | Built 2026-10-19; `src/lib/data/road-matrix.json` |
| U.S. Census Bureau / OMB [CBSA delineation, July 2023 (list 2, principal cities)](https://www.census.gov/geographies/reference-files/time-series/demo/metro-micro/delineation-files.html) | Market universe: cities named in a metro-area title | U.S. government work, public domain | July 2023 |
| U.S. Census Bureau [Vintage 2025 population estimates](https://www.census.gov/programs-surveys/popest/data/data-sets.html): `cbsa-est2025-alldata.csv`, `sub-est2025.csv` | Metro and city populations (July 1, 2025 estimates) | Public domain | Vintage 2025 |
| U.S. Census Bureau [2025 Gazetteer, places](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html) | Fallback city point (internal point) | Public domain | 2025 |
| OpenStreetMap via the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API) | City centre points (`place=city/town` nodes) and venue counts (`amenity=music_venue/nightclub/theatre`, `live_music=yes`) within 10 mi | © OpenStreetMap contributors, ODbL 1.0. The counts are a Produced Work and need attribution, which the UI footer and the Sources panel give. | Downloaded 2026-10-19 |

### Market universe

`scripts/data/build_markets.py` takes every city named in the title of a **Metropolitan Statistical Area** in the
lower 48 states plus DC (OMB, July 2023), where the metro's 2025 population estimate is **at least 200,000**. Only
incorporated places with a Vintage 2025 estimate are kept, which gives **385 cities**.

- **Consolidated governments** are shown by their common names. For example, "Nashville-Davidson metropolitan
  government (balance)" is shown as Nashville. The Census GEOID and every number still come from the Census row.
- **City names that repeat across states** (Portland, Columbus, Springfield…) are shown as "City, ST". A bare name
  resolves to the city with the largest metro.
- **City point:** the OpenStreetMap `place=city/town` node with the same name within 80 km of the Census internal
  point. This is the mapped city centre; the Census internal point can sit far from downtown (San Francisco's is in the
  Pacific because the city includes the Farallon Islands). Cities with no matching node keep the Census point. The
  source of each point is stored per city (`point`).
- **Not in the universe:** smaller towns, and places that aren't incorporated or aren't named in a metro title. For
  example, Brooklyn is a borough of New York, and Asbury Park isn't in a metro title. To add a market, change the rule
  and re-run the build.

### Venue counts

Venue counts show **mapped presence, not a complete inventory**. US mappers rarely use `amenity=music_venue` (Chicago
has none within 10 mi), so Fanpoint counts four kinds of feature within 10 mi of the city point: music venues,
nightclubs, theatres, and anything tagged `live_music=yes`. `amenity=events_venue` is excluded because it is mostly
wedding and banquet halls. Coverage varies by city: a low count can mean a city is under-mapped, not that it has no
rooms. The count is shown as context and **does not feed the score**.

### Road distances and times

- **Source:** OSRM table API, car profile, one directed matrix over all markets. The values are stored as rounded
  miles and minutes (uint16, base64 encoded) in `road-matrix.json`. No routing service is called at runtime.
- **What the times mean:** these are free-flow car times. They don't include traffic, stops, a trailer or a van's
  lower speed, so real van days run longer. That is why the hours limit is set conservatively.
- **Demo-server policy:** the FOSSGIS demo server (`router.project-osrm.org`) allows light, non-commercial use: at most
  1 request per second, a valid User-Agent, and attribution. It is **not for production**. Fanpoint only calls it at build time. A full build is 16 table requests of 100×100, with 1.5 s between requests and an
  identifying User-Agent. Blocks are cached and keyed by coordinates, so a rebuild only re-requests the blocks that
  changed. The 2026-10-19 data took 39 requests over three builds.
- **Self-hosting (production or refresh):**

  ```bash
  # US extract (~10 GB) from Geofabrik, then the OSRM docker images (BSD-2)
  wget https://download.geofabrik.de/north-america/us-latest.osm.pbf
  docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/car.lua /data/us-latest.osm.pbf
  docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-partition /data/us-latest.osrm
  docker run -t -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-customize /data/us-latest.osrm
  docker run -t -p 5000:5000 -v "$PWD:/data" ghcr.io/project-osrm/osrm-backend osrm-routed --algorithm mld --max-table-size 1000 /data/us-latest.osrm
  # then point the build at it (OVERPASS_URL works the same way for a private Overpass)
  OSRM_URL=http://localhost:5000/table/v1/driving/ python3 scripts/data/build_markets.py
  ```

  For the venue and city-centre queries at scale, run your own Overpass instance
  ([installation guide](https://wiki.openstreetmap.org/wiki/Overpass_API/Installation)). The public instance's
  guideline is roughly 10,000 requests and under 1 GB a day per user
  ([Overpass commons](https://dev.overpass-api.de/overpass-doc/en/preface/commons.html)). Fanpoint sends **two bulk
  requests per build**, not one per city.

## Touring rules (`src/lib/touring/rules.ts`)

| Key | Default | Status | Basis |
|---|---|---|---|
| `maxDriveMi` | 350 road mi/day | Assumption (adjustable) | A booking preference, not a law. Touring guides recommend much shorter van drives ([Roadi, *Tour Routing*](https://go-roadi.com/resources/learn/tour-routing)). Measured on OSRM road miles. |
| `maxDriveHours` | 7.5 h/day | Sourced (adjustable) | Government driver-fatigue guidance: "Do not drive more than 7.5 hours" ([Road Safety Scotland / Transport Scotland](https://roadsafety.scot/road-user-advice/driver-fatigue/)). For contrast, the US federal ceiling for hired passenger-carrier drivers is 10 h after 8 h off ([49 CFR § 395.5](https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-395/subpart-A/section-395.5)). Checked against OSRM free-flow hours. |
| `maxConsecutiveShows` | 6 shows | Adapted (adjustable) | The AFM's touring agreement for theatrical musicals ([Pamphlet B, Rule 16 A](https://www.afm.org/wp-content/uploads/2016/03/PamB_complete_2012-16-1.pdf)) requires one day off in each week (so at most 6 show days in 7), with days off no more than 12 performance days apart. Club tours aren't bound by it; Fanpoint uses it as a default. Anchors count as shows. |
| `radiusMi` | 60 mi (straight line) | Sourced (adjustable) | Club-show radius clauses run about 30–100 mi for 30–60 days. "Standard club radius: 100 km (60 miles) / 30 days prior / 15 days post" ([SystemOne](https://www.systemonesoftware.com/blog/radius-clause)). See also [How To Concerts](https://www.howtoconcerts.com/what-is-a-radius-clause/) and the [infract handbook](https://infract.at/handbook/guides/radius-clauses) (club: the city or 50–150 km, measured "in a straight line"). Festival scale for contrast: Lollapalooza's 300 mi, 180 days before and 90 after ([Rolling Stone](https://www.rollingstone.com/music/music-news/attorney-general-investigates-lollapalooza-233557/)). Real clauses are set per contract. |
| `dowWeights` | Sun 0.7, Mon 0.55, Tue 0.65, Wed 0.75, Thu 0.9, Fri 1.0, Sat 1.0 | Assumption (adjustable) | The direction is supported: weekend performances sell more ([Tseng 2009](http://hdl.handle.net/1903/9683), ticket data across 42 US markets for a touring family show), and Saturday is strongly preferred ([*Arts and the Market* 2018](https://doi.org/10.1108/aam-12-2017-0027)). No public dataset gives club-show weights by night, so the exact values are Fanpoint's. |
| `nightFloor` | 0.45 | Assumption (adjustable) | A night is filled only if Qloo heat × night weight is above this value. Not retuned on 2026-10-21. With the 0.94 floor it no longer refuses a night by itself (0.94 × 0.55 > 0.45); see "Live calibration". |
| `minAffinity` | **0.94** (was 0.6) | Assumption (adjustable), live-calibrated | Cities with Qloo heat below this aren't considered. Set as the 60th percentile of live corridor city reads, so it keeps the top 40% as 0.6 was meant to. See "Live calibration". |
| `spacingMi` | 50 mi | Assumption | Minimum distance between two consecutive fills, so they don't split one market's audience. |
| `progressMi` | 25 mi | Assumption | Turns "route in one direction, don't zig-zag" ([Roadi](https://go-roadi.com/resources/learn/tour-routing)) into a number: each stop must be at least this much closer to the next anchor. |
| `departMi` | 10 mi | Assumption | The same rule from the other side: each stop must be at least this much further from the previous anchor. |
| `minVenues` | 1 mapped venue within 10 mi | Assumption (data: OSM) | Real venue required. Markets with no live-performance venue mapped in OpenStreetMap ([Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API): `amenity=music_venue/nightclub/theatre`, `live_music=yes`) within 10 mi are removed as fills, in both With and Without Qloo. 4 of the 385 markets have none: Lenoir NC, Crestview FL, Lake Havasu City AZ, Warner Robins GA. The threshold is Fanpoint's; OSM coverage varies. |
| `corridorBufferMi` | 90 mi | Assumption | How far either side of the direct line Qloo's heatmap is read. Fixed in code; the model can't change it. |
| `metroReadRadiusMi` | **5 mi** (was 25) | Assumption, live-calibrated | Corridor heatmaps: a city takes the strongest Qloo heat cell within this distance. This is the smallest tested radius that reads at least 98% of corridor cities. |
| `nationalReadRadiusMi` | **15 mi** (new; was the shared 25) | Assumption, live-calibrated | Lower-48 heatmaps (co-headliner, coarser grid): the same read. This is the smallest tested radius that reads at least 98% of markets. |
| `strongThreshold` | **0.95** (was 0.75) | Assumption, live-calibrated | Co-headline: Qloo heat at or above this counts as a "strong city". Set as the 75th percentile of live lower-48 city reads (an act's top quarter). |
| `weakThreshold` | **0.91** (was 0.6) | Assumption, live-calibrated | Co-headline: Qloo heat below this counts as a "weak city". Set as the 60th percentile of live lower-48 city reads. |
| `peerPopularityBand` | ±0.15 | Assumption | Co-headline peers must be within this band of the artist's Qloo popularity. |
| `coheadAsymmetryPenalty` | 0.5 | Assumption | The complementarity score loses this much per city of imbalance between the two sides. |
| `coheadOverlapPenalty` | 0.25 | Assumption | The complementarity score loses this much per strong city the two acts share. |
| `peerCount` | 8 | Implementation detail | Peers requested from Qloo. It bounds the number of heatmap calls; the model can't change it. |
| `milePenalty` | 0.0004 per road mi | Implementation detail | Tie-break only: among otherwise equal routes, the shorter one wins. |

## Live calibration (2026-10-21)

The thresholds were retuned on the first runs against live Qloo (10 real acts, 40 corridor heatmaps and 10 lower-48 heatmaps). Qloo's terms keep response data out of a public repo, so this section describes only the method and the resulting rule values. The measured quantiles and before/after tables stay outside the repo (`baselines/`, gitignored). Rerun them with `scripts/verify-qloo-live.mjs` (shapes), `scripts/heat-read-sensitivity.mjs` (read radius and quantiles) and `npm run baseline` / `npm run compare-baselines` (see `docs/DEPLOY.md`, "Live re-run").

**What the data showed (qualitatively)**
- Every endpoint Fanpoint calls returned 200 and passed the zod schemas unchanged: `/search`, `/v2/tags`, and `/v2/insights` for artist, place, brand, podcast, destination and heatmap.
- Heatmap `affinity` behaves like a percentile of the cells in each response. Qloo's docs call it "a normalized measure" ([Heatmap Insights](https://docs.qloo.com/reference/heatmaps)).
- A city reads the best cell within a radius, so at the original 25 mi radius city reads bunched near 1 and the old thresholds (written for percentile-like city reads) barely selected anything.
- Corridor heatmaps come back on a finer grid than the lower-48 one, so the two need different read radii.

**Method (fixed before looking at any demo)**
- Read radius: the smallest tested radius (3, 5, 10, 15, 25 mi) that still reads at least 98% of cities. Result: `metroReadRadiusMi` 25 → **5 mi** (corridors) and the new `nationalReadRadiusMi` **15 mi** (lower-48).
- Thresholds: each old value t was meant as "the t-th percentile", so the new value is the t-th percentile of the pooled live city reads at the new radii, rounded to 2 decimals. Result: `minAffinity` 0.6 → **0.94**, `strongThreshold` 0.75 → **0.95**, `weakThreshold` 0.6 → **0.91**.
- `nightFloor` stays at 0.45: there is no principled mapping for a heat × weight product. With the 0.94 floor it no longer refuses a night by itself (0.94 × 0.55 > 0.45); the weights still pick which night each city gets. **Open question for Mellow.**

**Also changed because of live data**
- `/search` returns its closest matches for any query, so a made-up name can resolve to an unrelated real act. `resolve_artist` now needs an exact name match (ignoring case, accents, punctuation and a leading "The") and otherwise names the closest results.
- `filter.location.query` with a bare city name can resolve to a same-named place in another state or country, so Fanpoint always sends "City, ST" and drops any returned room more than 25 mi from the city.
- The mock heatmap now has the live shape: cell affinity is converted to a percentile within each response, and every market in the polygon gets a cell. The mock profile value is kept as `affinityRank`.

**Not changed, flagged**
- The destination fallback (used only when a heatmap is empty) returns entity affinities that fall under the 0.94 floor, so a fallback corridor now yields no fills. That's safe, but worth revisiting if fallbacks show up in production.
- Co-headliner complementarity can favour peers whose own heat is weak in many of the headliner's strong cities. The asymmetry penalty softens this but doesn't remove it. The weights (`coheadAsymmetryPenalty`, `coheadOverlapPenalty`) are still Fanpoint's judgement.

## With Qloo / Without Qloo (`src/lib/route/rank.ts`)

The primary comparison. It is deterministic and uses only data already in the pipeline.

- **Candidate set, identical in both modes:** every market inside the anchor-to-anchor corridor polygon that passes the
  hard filters that need no taste data. Those are the market universe (Census metro population ≥ 200,000), not an
  anchor, outside the radius clause, between the anchors, a known OSRM road route, and playable on at least one off day
  within the OSRM miles *and* hours per day, with at least one OSM-mapped venue (`minVenues`). The Qloo heat floor is not
  applied, because it needs affinity.
- **With Qloo (default):** the act's Qloo affinity at the city (the corridor heatmap read), descending. Ties go to the
  heat cell's Qloo popularity, then the market id. Cities with no Qloo reading come last.
- **Without Qloo:** a fixed proxy, chosen before looking at any result and not tuned: Census Vintage 2025 city
  population, descending. Ties go to the OpenStreetMap venue count within 10 mi, then the market id. Affinity is
  stripped from these rows.
- **Co-headliner:** With Qloo ranks by complementarity of both acts' per-city Qloo affinity (unchanged). Without Qloo
  the peers are listed alphabetically and none is recommended, because with no fan signal the pairing can't be judged.
- **Mock data caveat:** until the hackathon key arrives, both lists come from the synthetic mock heatmap. Re-check
  the before/after on live data before quoting it.

## What the LLM does, and what it can't do

| Output | Decided by | LLM role |
|---|---|---|
| Fill cities and dates | `fillTour` dynamic programme over Qloo heat × night weights, OSRM legs and the rules above | None |
| Support act, rooms, promo partners | The top Qloo result per city | Writes the promo angle (numbers checked) |
| Corridor width, peer count, peers compared | Fixed in code (`rules.ts`) | None: the tool arguments no longer exist |
| Drive limits | The user's request plus `rules.ts` | None: `fill_gaps` takes no arguments |
| Missing city intel | Fetched by Fanpoint if the model skips it | None |
| Headline, "why", summary | Generated from the data | An optional extra note, labelled "AI", kept only if every number matches the data |
| Recommended co-headliners | Top 3 positive complementarity scores | Writes the pitch (numbers checked) |
| "Plain AI" baseline | The LLM alone (a comparison, clearly labelled) | Everything. Then audited in code with OSRM and the rules. |

## Not modelled (no open source)

Ticket sales, venue capacity and availability, guarantees, routing costs, traffic, and the terms of a specific
contract.
