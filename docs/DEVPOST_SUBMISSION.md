# Devpost submission: DRAFT (do not submit until the checklist is green)

> **Committed copy: MOCK data only** (fictional "(mock)" acts, synthetic Qloo responses). Qloo's terms keep live response
> data out of a public repo; the live copy is the gitignored `docs-live/DEVPOST_SUBMISSION.live.md`, with live screenshots
> in `screens-live/`. Paste and upload from those.

**Project name:** Fanpoint

**Try it out:** Live demo https://routed-kt93.onrender.com · Repo https://github.com/Mellowoah/Fanpoint (MIT license, visible in About) · (no demo video required)

**Tagline:** Fill the empty nights on a tour. Fanpoint reads Qloo fan data to book more shows between an act's fixed dates, with zero touring-rule breaks.

An empty night on tour still costs a hotel, a van and a crew, and earns nothing. When an act lands a festival slot or a support date, its agent has to fill the days in between, usually by gut feel about which cities hold fans.

Fanpoint fills those nights. Enter the act and 2–3 booked dates. It reads where the act's fans are along each drive from Qloo, cuts every city that would break a touring rule, and returns a bookable run with named rooms, one support act and hold-request drafts.

**The result**, measured on 10 acts: a median of 7 of 13 open nights booked versus 5 for the same LLM with no tools, and 0 versus 3 of 10 plans breaking a touring rule. With Qloo turned off and the same rules, the demo books 0 of 13 nights instead of 8.

**How it stays honest:** every decision is computed in code from Qloo data and sourced touring rules. The LLM only calls tools and explains; a note with any number that isn't in the data is dropped. The agent trace shows every Qloo request.

## Benchmark: Fanpoint vs plain AI

Measured 2026-10-21: 10 artists, live Qloo + Gemini, the same booked dates for every act, 13 open days each. Aggregates only; per-artist runs stay in the gitignored `baselines/`. In-app numbers come from `src/lib/benchmark.ts`.

| | Fanpoint + Qloo | Plain AI (same LLM, no tools) |
|---|---|---|
| Nights booked (of 13) | 5–10, median 7 | 4–13, median 5 |
| Radius-clause breaks per plan | 0 | 0–3 (8 in total) |
| Backtracking legs per plan | 0 | 0–5 (10 in total) |
| Longest run of consecutive shows | 3–6 (cap 6) | 1–16 |
| Plans breaking at least one hard rule | 0 of 10 | 3 of 10 |

With vs without Qloo on the same filtered cities: on the 34 legs with more than 5 eligible cities, the two top-5 lists matched on only 2; the median overlap was 2 of 5.

**Method.** Same hard rules for both: radius clause, no backtracking, daily drive cap, at most 6 shows in a row. Fanpoint's checker audits Plain AI's picks on OSRM road data; Fanpoint's own zero comes from only booking cities that pass the filters. Reproduce with `npm run eval` and `npm run baseline` ([DEPLOY.md](DEPLOY.md#live-re-run-mock-vs-live-baseline)).

---

## What you get
**Who it's for:** indie artists, their agents and regional promoters. An act lands a festival slot or a support date and must fill the days between; an empty day still costs a hotel and a van.

**Fill the gaps.** Enter the act and 2–3 booked dates; get ranked gap cities, drive times and a sourced "why this city" for each stop.
- For each drive, Fanpoint reads the act's Qloo fan heatmap in a corridor around the route and scores the markets in it (385 U.S. cities).
- Code removes cities that break a rule and says why: inside a 60 mi radius clause, doubling back, no mapped venue within 10 mi, over 7.5 h of driving a day (OSRM), more than 6 shows in a row, or below the heat floor. A city that passes but doesn't fit the schedule names the limit that stopped it. Thanksgiving, Christmas Eve and Christmas Day stay off by default (an adjustable rule; New Year's Eve stays bookable).
- An optimiser fills open days by fan heat × night-of-week weight, or leaves the night off.
- One support act opens the whole run: the Qloo match that is a local fit in the most filled cities and clearly smaller than the headliner, with the taste they share.
- Each stop names a Qloo venue (address, website, size tier, capacity where Qloo's text states one), the top 3 fan neighbourhoods and promo partners. **Why this stop** cites a source for every line.
- Each stop gets a hold-request draft (nothing is sent); the run exports to `.ics`.

## Try it: one-click examples
Open the live link and click an example (each run takes 45–60 s):
- **Japanese Breakfast · East:** New York Nov 13 → Durham Nov 21 → Atlanta Nov 28
- **Big Thief · Boston to Nashville:** Boston Dec 4 → Washington Dec 11 → Nashville Dec 18
- **Khruangbin · West Coast:** Seattle Dec 4 → San Francisco Dec 11 → Los Angeles Dec 18

Then press **Compare with plain AI** for both plans side by side, rule breaks in red. To stress it, set 250 mi and 4 shows in a row in **Touring rules**; the candidate filter shows which cities drop and why.

## Also in Fanpoint
**Co-headliner match.** Fanpoint takes peers in your Qloo popularity band and ranks them by complementarity: they're strong where you're weak, and the reverse, with overlap penalised. The map shows which act carries each city. The most similar peer is shown on purpose; it shares your strong cities, so it ranks low. Each pair shows shared taste tags, age/gender skews and a joint room.

**With Qloo / Without Qloo.** Without Qloo ranks the same filtered cities by population and venues: every act gets the same list, nothing is booked, no co-headliner is ranked.

**Adjustable, cited rules.** Drive caps, shows in a row, radius clause, holidays and night weights are editable; each is labelled as sourced or as Fanpoint's assumption.

**Promoter side.** Pick a city (optionally a genre) to get the 10 acts Qloo ranks highest there, each with "Plan a routing". **Who fits this room** ranks acts for one of the city's venues.

## How it uses Qloo
| Question | Qloo call | Used for |
|---|---|---|
| Which act? | `/search` (`types=urn:entity:artist`) | Entity id signal |
| Where are the fans along this drive? | `/v2/insights` `filter.type=urn:heatmap`, `signal.interests.entities`, `filter.location=POLYGON(corridor)` | Ranking corridor cities |
| Which room? | `urn:entity:place` + `filter.location=POINT(market centre)` + `filter.location.radius` + venue `filter.tags` | Named top room per stop |
| Which neighbourhoods? | `urn:heatmap` + `output.heatmap.boundary=urn:entity:locality` + same POINT | Top 3 fan neighbourhoods per stop |
| Who supports? | `urn:entity:artist` + `filter.popularity.max` (headliner − 0.02), nationally and per city with `signal.location.query`; `/v2/analysis/compare` | One opener for the run (most filled cities, then national fit), shared taste; per-city alternatives |
| Promo hooks | `urn:entity:brand`, `urn:entity:podcast` + `signal.location.query` | Partner ideas |
| Who could co-headline? | `urn:entity:artist` + `filter.popularity.min/max` | Peers in the same band |
| Do their markets complement ours? | `urn:heatmap` per act over the lower 48 | City-by-city complementarity |
| What do the audiences share? | `/v2/analysis/compare`, `urn:demographics`, `urn:entity:place` | Shared tags, age/gender skews, a joint room |
| Promoter: who fits this room? | `urn:entity:place`, then `urn:entity:artist` + `signal.interests.entities=<room>` | Acts ranked for one room |

Picks and rankings are computed in code from these responses. The hard filters only say where a show *can* go; Qloo says where this act should play. The LLM chooses tools and writes notes, and a note with a number not in the data is dropped.

## Example (mock fixtures, illustrative only)
Fictional act "Marigold Static", booked New York (Nov 13) → Durham (Nov 21) → Atlanta (Nov 28), 13 open days. Live examples and the live eval are in `docs-live/`.

| Leg | With Qloo, top 5 (mock heat) | Without Qloo, top 5 (Census/OSM) | Shared |
|---|---|---|---|
| New York → Durham | Richmond, Camden, Philadelphia, Charlottesville, Baltimore | Philadelphia, Washington, Baltimore, Virginia Beach, Chesapeake | 2 of 5 |
| Durham → Atlanta | Asheville, Greenville, Greer, High Point, Charlotte | Charlotte, Winston-Salem, Fayetteville NC, Augusta, Macon | 1 of 5 |

With mock heat, Fanpoint books 4 of 13 open days (Camden, Baltimore, Richmond, Asheville); without Qloo, none. Co-headliner with "Saltwater Hymnal (mock)" proposed: With Qloo ranks 8 mock peers (top 3: Velvet Orchard, June Arcade, Moth Radio), the partner 6th; Without Qloo recommends nobody.

## How we built it
- **Next.js 16 / React 19 / TypeScript / Tailwind 4**, streaming agent events as NDJSON so results fill in live.
- **Agent:** OpenAI-compatible tool calling (Gemini `gemini-3.5-flash-lite`) over documented Qloo GET endpoints; zod-validated outputs.
- **Routing:** a dynamic programme per gap on a precomputed OSRM road matrix (148,225 market pairs), so no routing calls at runtime.
- **Data:** U.S. Census (metros, population) and OpenStreetMap (city centres, venues) on a Leaflet map. Qloo calls are server-side; no Qloo data is stored in the repo.

## Challenges we ran into
- **What the LLM should do.** Every pick moved into code so results are reproducible; the model orchestrates, and a number check (`vetText`) blocks invented figures.
- **Heat bunches near 1.** Heatmap `affinity` is a percentile within each response, and a city takes the best cell near it. We cut the read radius and recalibrated the heat floor and thresholds on live data (`docs/SOURCES.md`, "Live calibration").
- **Location matching.** "Camden, NJ" matched Camden County, so room searches now use the market's centre point and a radius.

## Limitations
- Fan heat is an audience signal, **not a ticket forecast**; no revenue figures.
- Qloo has no capacity field, so the size tier is a heuristic from the venue's category; capacity appears only when Qloo's text states one.
- No availability, guarantees or competing shows. Hold emails are drafts; a booker confirms every date.
- Drive times are OSRM free-flow car times; a van is slower. Night-of-week and co-headline weights are labelled assumptions. Heat thresholds are calibrated on one live sample (10 acts), not on ticket sales.
- Heat is relative within each response: it compares cities in one corridor, not across tours. US only, 385 markets.

## What's next
- Import holds and avails from an agency calendar; multi-van routing.
- Second runs: strong cities a run skipped, and when to return.
- Sending holds through Fanpoint; per-date profit estimates.
- Pilot with a few agents and promoters.

## Built with
`qloo` `next.js` `react` `typescript` `tailwindcss` `leaflet` `zod` `gemini` `openai-compatible-llm` `osrm` `openstreetmap` `overpass-api` `us-census` `docker` `render`

### Image captions (upload from `screens-live/`; re-capture any marked *new*)
1. Calendar and map: open days filled, road hours per leg, fan heat along each drive.
2. Why this stop: named venue, fan neighbourhoods, hold draft, each line sourced (*new*).
3. With Qloo vs Without Qloo: the same cities, ranked by fan affinity vs population.
4. Co-headliner map: which act carries each city; the most similar act ranks low.
5. Promoter view: a city's top acts, and who fits one room (*new*).
6. Compare with plain AI: same dates, side by side, rule breaks in red (*new*).
7. One-click examples (*new*).

---

### Submission checklist (Mellow)
Required by [qloo.devpost.com](https://qloo.devpost.com) (checked 2026-10-21): hosted demo, public repo with run instructions, a description, an open-source license in About. **No video.**
- [ ] `QLOO_API_KEY` set on the host (verified locally 2026-10-21: `scripts/verify-qloo-live.mjs`)
- [ ] `LLM_API_KEY` (Gemini) set on the host; free-tier limits checked (verified locally 2026-10-21: `npm run verify:llm`)
- [ ] Public repo; MIT license in About; no live Qloo data committed
- [ ] Always-on public URL that works logged-out, on mobile and cold, through Nov 16 11:45 PM ET
- [ ] Live screenshots for captions 2 and 5 (current `screens-live/` predate venues and the promoter view)
- [ ] Devpost text pasted from `docs-live/DEVPOST_SUBMISSION.live.md`, screenshots from `screens-live/`; numbers from live runs only
- [ ] Submitted on Devpost before **Oct 30, 2026, 11:45 PM ET** (target Oct 28)
