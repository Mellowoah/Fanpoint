# Devpost submission: DRAFT (do not submit until the checklist is green)

> **This committed copy uses MOCK / SAMPLE data only.** Every example below comes from Routed's fictional mock fixtures
> (acts marked "(mock)"; Qloo responses are synthetic), so it is safe for the public repo. Qloo's terms keep live response
> data out of a public repo, so the version with live numbers, live examples and the live eval lives in the gitignored
> `docs-live/DEVPOST_SUBMISSION.live.md`, and the live screenshots in the gitignored `screens-live/`. Paste and upload
> from those for Devpost. Rewrite in your own words where it reads stiff. Judges and Devpost advise against AI-sounding prose.

**Project name:** Routed

**Tagline (≤ 140 chars):** A routing desk for booking agents and promoters: fill a tour's off days and match co-headliners using Qloo fan heatmaps.

**Try it out:** Live demo [TODO: public URL] · Repo [TODO: public GitHub URL, MIT license visible in About] · Video [TODO, optional]

---

## Summary for judges
- **What it is:** Routed is a decision tool for booking agents and promoters. Fixed dates go in; gap cities with real road miles and hours come out. Two acts go in; a complementary fan map comes out.
- **Where the numbers come from:**
  - fan affinity: Qloo
  - road miles and hours: OSRM on OpenStreetMap
  - markets and population: the U.S. Census Bureau
  - venue counts: OpenStreetMap
  - touring rules: cited sources, or labelled as adjustable assumptions.

  Decisions are made in code. The LLM orchestrates and explains, and any number it writes must match the data.
- **Who it's for:** the people who book and route shows (agents, tour managers, regional promoters), not the artist's fan-facing planning.
- **What only Qloo makes possible:** ranking the cities *along a specific drive* by how strongly this act's audience over-indexes there, and comparing two acts' fan geography city by city. Both come from Qloo Insights heatmaps. An LLM can't measure either.
- **Test it in under 60 seconds:** open the live link and press **Fill the gaps** (demo anchors are prefilled). Flip **With Qloo / Without Qloo** above the results and watch the ranked gap cities change. Then open **Co-headliner match** and flip the same toggle.

## Inspiration
A routing usually starts with anchors: a festival slot, a support date, a hometown show. The days between them are where a
run makes or loses money. Each one is either a show or an empty night with hotel and van costs. Agents fill them from memory
and spreadsheets: which secondary markets sit on the way, which rooms fit, who to pair with. Taste data can answer the
first question directly, and Qloo's heatmaps tell you where an act's audience actually is.

Several entries in this hackathon plan tours from an artist's point of view (cities, venues, openers, an itinerary).
Routed is built for the people who book and route shows. It starts from dates that are already confirmed, and it treats
co-billing as a market-coverage decision.

## What it does
**1. Fill the gaps.** Enter the act and 2–3 anchors (city, date, what it is) and pick a max drive per day.
- For each anchor-to-anchor leg, the agent reads the act's **Qloo fan heatmap inside a corridor polygon** around the drive. Each touring city in the corridor gets the strongest heat cell near it.
- The market universe is the 385 cities named in U.S. metro-area titles (Census/OMB, metro population ≥ 200k).
- Code removes cities that break touring rules and shows the reason for each one:
  - inside a radius clause around an anchor (60 mi: the "standard club radius")
  - doubling back
  - no live-performance venue mapped in OpenStreetMap within 10 mi (real venue required)
  - too far for the days available, by **OSRM road miles and drive hours** (7.5 h a day, from driver-fatigue guidance)
  - more than 6 shows in a row (adapted from the AFM's one-day-off-a-week rule)
  - below the heat floor
- A deterministic optimiser fills the off days. It maximises fan heat × night-of-week weight within every limit. It leaves a night off when no city is worth more than an off day.
- The output is:
  - a calendar strip: anchors, fills, remaining off days, and road miles and hours per leg
  - a map where the corridors light up with fan heat
- Each fill gets a card with a **Why this stop** block. Every line has a source:
  - Qloo fan heat and rank in the corridor
  - OSRM road miles and hours
  - the night weight, labelled as an assumption
  - Census city and metro population
  - OpenStreetMap venue count, with a map link
- The card also lists the top Qloo support act, rooms and promo partners.
- A **Touring rules** panel lets you change the defaults. The amber ones are Routed's assumptions with no solid source. **Sources & methodology** lists every source, license and rule.

**2. Co-headliner match.** Enter your act and, optionally, a proposed partner.
- Routed finds peer acts in the same popularity band and reads a **nationwide Qloo heatmap for every act**.
- It scores **complementarity**: the cities where you're weak and they're strong, plus the reverse, with overlap penalised.
- The map is coloured by which act carries each city. The text says how many cities have at least one strong act, for each act alone and for the pair.
- The most taste-similar peer is shown on purpose, with how many strong cities it shares and where it ranks. A near-twin that shares most strong markets ranks low, which is why similarity alone is the wrong way to pick a co-headliner. [Live example: see `docs-live/DEVPOST_SUBMISSION.live.md`.]

**3. With Qloo / Without Qloo.** The primary comparison is deterministic. Both modes start from the same candidate set: the corridor's cities after the hard filters (Census market floor, radius clause, no backtracking, a mapped venue, OSRM drive limits). **With Qloo** (the default) ranks them by the act's Qloo affinity at each city. **Without Qloo** ranks them by a fixed, untuned proxy: Census city population, with OpenStreetMap venue count as the tie-break. Every city shows a score line ("Qloo affinity: 0.XX | Ranked by affinity after filters" or "No affinity signal | Ranked by population/venues only"). On the co-headliner tab, Without Qloo leaves the peers unranked, because without fan geography the pairing can't be judged.

**4. Receipts and a secondary baseline.** Every Qloo request appears in the agent trace. Below the results, an optional **Plain AI** panel sends the same anchors to the same LLM with no Qloo tools, and **Compare** audits both plans with the same rules.

**Promoter side.** A role switch ("I'm a promoter") turns it around: pick one of the 385 cities (optionally a Qloo music genre tag) and get the top 10 acts Qloo ranks by fan affinity there (`/v2/insights` `filter.type=urn:entity:artist` + `signal.location.query`), each with "Plan a routing" into Fill the gaps.

## How it uses Qloo
| Question | Qloo call | Used for |
|---|---|---|
| Which act? | `/search` (`types=urn:entity:artist`) | Entity id signal |
| Where are the fans along this drive? | `/v2/insights` `filter.type=urn:heatmap`, `signal.interests.entities`, `filter.location=POLYGON(corridor)` | Corridor ranking of touring cities |
| Fallback ranking | `/v2/insights` `urn:entity:destination` + same polygon | Only if a heatmap is empty |
| Which rooms? | `/v2/tags` (music venue), then `urn:entity:place` + `filter.location.query` + `filter.tags` | Rooms per fill |
| Who supports? | `urn:entity:artist` + `signal.location.query` + `filter.popularity.max` + `filter.exclude.entities` | Local support no bigger than the headliner |
| Promo hooks | `urn:entity:brand`, `urn:entity:podcast` + `signal.location.query` | Cross-domain partner ideas |
| Who could co-headline? | `urn:entity:artist` + `filter.popularity.min/max` | Peers in the same band |
| Do their markets complement ours? | `urn:heatmap` per act over the lower-48 polygon | City-by-city complementarity |

Rankings, scores and picks are computed in code from these responses:

- the support act, rooms and promo partners are the top Qloo results;
- "recommended" co-headliners are the top 3 positive scores.

The LLM decides which tool to call next and writes optional notes. Any number in its text that isn't in the data
drops the note and adds a warning. Tests run models that try to cheat: they invent numbers, skip steps, choose their
own peers or widen the corridor, and code wins every time.

## What breaks without Qloo
| Decision | Plain LLM | Routed + Qloo |
|---|---|---|
| Which gap cities | Familiar big markets near the route | Corridor cities ranked by this act's fan heat |
| Touring reality | Not checked (our audit uses OSRM road data to flag over-limit days, radius-clause and backtracking legs) | Enforced in code: OSRM miles and hours per day, shows in a row, no backtracking, radius clause |
| Co-headliner | The most similar-sounding act | The act whose strong cities cover your weak ones |

## Why Qloo is essential
Gap-city ranking and co-headliner complementarity are ordered by Qloo affinity scores after hard filters. The With/Without Qloo toggle shows the ranked outputs change when affinity is removed.

We audited every decision point in the code (README, "Where Qloo decides"). Each step that chooses or orders something in the default mode uses Qloo data:

- which cities are scanned along a drive (the corridor heatmap);
- the heat floor;
- the optimiser's objective (fan heat × night weight);
- the corridor ranking;
- the support act, rooms and promo partners (top Qloo Insights results);
- the co-headliner peer list (Qloo's popularity band) and its ranking (complementarity of both acts' per-city Qloo affinity).

What is left without Qloo is the hard filters (Census market floor, radius clause, no backtracking, a mapped venue, OSRM drive limits), which only say where a show *can* go, and the population/venue proxy, which can't tell one act from another. Every act gets the same Without Qloo list for the same dates. With Qloo the list belongs to the act.

**Sample (MOCK fixtures, illustrative only).** The fictional act "Marigold Static" on the demo anchors New York (Nov 13) → Durham (Nov 21) → Atlanta (Nov 28), 13 off days, in mock mode. The live version of this table, the live co-headliner example and the live leg-overlap statistics are in `docs-live/DEVPOST_SUBMISSION.live.md`.

| Leg | With Qloo, top 5 (mock heat) | Without Qloo, top 5 (Census/OSM proxy) | Shared |
|---|---|---|---|
| New York → Durham | Richmond, Camden, Philadelphia, Charlottesville, Baltimore | Philadelphia, Washington, Baltimore, Virginia Beach, Chesapeake | 2 of 5 |
| Durham → Atlanta | Asheville, Greenville, Greer, High Point, Charlotte | Charlotte, Winston-Salem, Fayetteville NC, Augusta, Macon | 1 of 5 |

With (mock) Qloo heat, Routed books 4 of the 13 off days: Camden, Baltimore, Richmond and Asheville. Without Qloo it books none, because there is no fan signal to tell a show from a night off. The Without Qloo list depends only on Census and OpenStreetMap, so it is the same for every act on the same dates.

Co-headliner sample (mock): Marigold Static with "Saltwater Hymnal (mock)" proposed. With Qloo ranks the 8 mock peers by complementarity (top 3: Velvet Orchard, June Arcade, Moth Radio) and scores the proposed partner 6th of 8. Without Qloo leaves the peers unranked and recommends nobody.

**Eval (`npm run eval`, Routed + Qloo vs Plain AI).** [Live numbers: see `docs-live/DEVPOST_SUBMISSION.live.md`. They are not committed, because they are derived from live Qloo responses.] The eval runs both sides on the same anchors and scores the Plain AI's cities with the same Qloo corridor reads and the same touring rules. In mock mode the Plain AI side is a labelled simulation, so mock eval numbers are not publishable.

**Default demo.** In live mode the prefilled demo acts are real artists (picked by a rule written down before ranking: lowest With/Without overlap, a non-tied ranking, most off days filled; the live reasoning is in the gitignored live copy). The fictional mock acts stay as the offline default.

## How we built it
- **Next.js 16 / React 19 / TypeScript / Tailwind 4.** One `POST /api/plan` streams agent events as NDJSON, so the trace, calendar and map fill in live.
- **Agent:** OpenAI-compatible tool calling (Google Gemini `gemini-3.5-flash-lite` on the free tier by default) over two tool sets (fill and co-headline). Tools wrap only documented Qloo GET endpoints. The submit tools are zod-validated, with a grounding check.
- **Routing:** a per-gap dynamic programme in plain TypeScript, on a **precomputed OSRM road matrix** covering all 148,225 market pairs.
  - The matrix was built once from the OSRM demo server, within its usage policy (16 requests at ≤1 req/s), and committed. No routing call is made at runtime.
  - Self-hosting steps are in `docs/SOURCES.md`.
  - Every rule lives in one cited config file, which the UI renders.
- **Open data:**
  - U.S. Census (public domain): OMB metro delineation, Vintage 2025 population, Gazetteer.
  - OpenStreetMap via Overpass (ODbL, attributed): city centres and venue counts, from 2 bulk requests.
- **Map:** Leaflet with self-hosted US state outlines, heat cells drawn from the Qloo heatmap responses.
- **Data handling:** Qloo calls are server-side only, throttled to the reported rate limit and cached in memory. No Qloo data is stored in the repo. The fixtures are synthetic.

## Challenges we ran into
- Deciding what the LLM should and shouldn't do. Ranking, routing and every pick moved into code so the numbers are reproducible. The model orchestrates and explains, and a number check (`vetText`) stops it from slipping in invented figures.
- Real data is messy:
  - Census names consolidated cities "Nashville-Davidson metropolitan government (balance)".
  - San Francisco's Census point is in the Pacific.
  - US mappers rarely use `amenity=music_venue` (Chicago has none), so venue counts are shown as mapped presence, not an inventory.
- Finding real sources for touring rules. Drive time, days off and radius clauses have them. Night-of-week weights don't, so they are labelled as assumptions and can be changed.
- Making "realistic" explicit: radius clauses, no backtracking and night-of-week value are simple rules, but they change the answer a lot.
- Live API lessons:
  - Heatmap `affinity` is a percentile of the cells in each response, and a city takes the best cell near it, so city reads bunch near 1. We cut the read radius and moved the heat floor and the strong/weak thresholds to the live percentiles they were designed to mean. The method is in `docs/SOURCES.md`, "Live calibration".
  - `/search` always returns its closest matches, so a made-up name resolves to a real act. Routed now needs an exact name match and otherwise lists the closest names.
  - A bare city name in `filter.location.query` can resolve to a same-named place elsewhere, so Routed sends "City, ST" and drops rooms more than 25 mi away.
  - Gemini 3 models return a thought signature on each tool call and refuse the next turn if it isn't sent back, so Routed keeps it with the assistant turn.
  - Every Qloo endpoint we call passed our zod schemas unchanged.

## Accomplishments that we're proud of
- An anchors-first routing workflow that matches how shows are actually booked.
- A complementarity view that argues *against* the most similar act when it shares the same markets.
- Every number traceable to a Qloo request.

## Limitations
- Fan heat is an audience signal, **not a ticket forecast**. We show no revenue or sell-through figures.
- There are no venue capacities, holds, guarantees, availability or competing shows. A human booker confirms every date.
- Drive times are OSRM free-flow car times, with no traffic or stops, so a van runs slower. The night-of-week weights and co-headline weights are labelled assumptions. The heat floor and strong/weak thresholds are calibrated on one live sample (10 acts, 2026-10-21), not validated against ticket sales.
- Heat is relative within each Qloo response, so a city's heat compares it with the rest of that corridor, not with other tours.
- US only, 385 markets (cities in metro titles, metro ≥ 200k). OpenStreetMap venue coverage varies by city.

## What's next
- Holds and avails import (CSV from the agency's calendar), rest-day rules and multi-van routing.
- Second-run planning: which strong cities the run skipped, and when to come back.
- Future work, not built: promoter connect (agents and promoters see each other's interest in a city), offers and holds sent through Routed, profit estimates per date (guarantee, ticket price, room size), and a light agent CRM for promoter contacts.
- Pilot with a few agents and promoters. Pricing would be per seat for small agencies and promoters.

## Built with
`qloo` `next.js` `react` `typescript` `tailwindcss` `leaflet` `zod` `gemini` `openai-compatible-llm` `osrm` `openstreetmap` `overpass-api` `us-census` `docker` `render`

### Image captions (6–8; upload the live captures from `screens-live/`, the committed `screens/` are mock)
1. Calendar: anchors in, off days filled, OSRM road miles and hours per leg.
2. Corridor fan heat map: Qloo heatmap cells along each drive.
3. The filter: every scanned city with its fan heat and why it was kept or removed.
3b. With Qloo vs Without Qloo: same filtered cities, ranked by Qloo affinity vs by population/venues.
4. Agent trace: the exact Qloo heatmap and Insights requests.
5. Plain AI audit: same anchors, no Qloo, with rule violations in red.
6. Compare: both plans, same rules, same corridor reads.
7. Co-headliner map: coloured by which act carries each city, with the complementarity score.
8. Most similar ≠ best partner.
9. Why this stop: Qloo heat, OSRM road leg, Census population, OSM venues, each with its source.
10. Sources & methodology: every rule with its citation or "assumption" label.

---

### Submission checklist (Mellow)
- [ ] Qloo hackathon key set as `QLOO_API_KEY` on the host (verified locally on 2026-10-21: `scripts/verify-qloo-live.mjs`, live baseline)
- [ ] Gemini key (`LLM_API_KEY`) set on the host; free-tier limits checked in AI Studio (verified locally on 2026-10-21: `npm run verify:llm`)
- [ ] Public GitHub repo; MIT license shows in About; no live Qloo data committed (live material only in gitignored `docs-live/` and `screens-live/`)
- [ ] Deployed to an always-on public URL that works logged-out, on mobile and cold, through Nov 16 11:45 PM ET
- [ ] Devpost text pasted from `docs-live/DEVPOST_SUBMISSION.live.md`, screenshots uploaded from `screens-live/`; every `[TODO]` replaced; numbers come from live runs only
- [ ] Submitted on Devpost before **Oct 30, 2026, 11:45 PM ET** (target Oct 28)
