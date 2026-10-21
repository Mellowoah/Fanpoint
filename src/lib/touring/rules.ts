/**
 * Every number that shapes a Fanpoint recommendation, in one place, each with its provenance.
 *
 * kind:
 *   "sourced"     the default comes from a cited source (still adjustable where marked);
 *   "adapted"     a cited source exists for a neighbouring context (e.g. theatre tours); Fanpoint applies it to club tours;
 *   "assumption"  no solid source; Fanpoint's adjustable default, labelled as such in the UI;
 *   "internal"    an implementation detail that only breaks ties or bounds work; it doesn't express a touring fact.
 *
 * docs/SOURCES.md has one entry per key (a test enforces this). The UI's "Sources & methodology" panel renders this
 * registry directly, so the code, the docs and the screen can't drift apart.
 * Client-safe: no server imports.
 */
export type RuleKind = "sourced" | "adapted" | "assumption" | "internal";
export interface Citation { title: string; publisher: string; url: string; note?: string }
export interface Rule<T = number | readonly number[]> {
  value: T; unit: string; label: string; kind: RuleKind;
  /** User-adjustable in the form (and via the API's `rules` object). */
  adjustable: boolean;
  why: string; sources: Citation[];
}

const FMCSA: Citation = { title: "49 CFR § 395.5: Maximum driving time for passenger-carrying vehicles", publisher: "U.S. eCFR / FMCSA", url: "https://www.ecfr.gov/current/title-49/subtitle-B/chapter-III/subchapter-B/part-395/subpart-A/section-395.5", note: "10 h driving after 8 h off duty; applies to commercial passenger carriers such as hired tour-bus drivers." };
const RSS: Citation = { title: "Driving tired kills: tips to avoid driving tired", publisher: "Road Safety Scotland (Transport Scotland)", url: "https://roadsafety.scot/road-user-advice/driver-fatigue/", note: "\"Do not drive more than 7.5 hours\"; breaks of 15-20 min every two hours." };
const AFM: Citation = { title: "Pamphlet B (touring theatrical musicals), Rule 16 A: Days off", publisher: "American Federation of Musicians", url: "https://www.afm.org/wp-content/uploads/2016/03/PamB_complete_2012-16-1.pdf", note: "\"one (1) day off in each week free of performances\", days off \"no further apart than twelve (12) consecutive performance days\"." };
const SYSTEMONE: Citation = { title: "What the radius clause means & why promoters include it", publisher: "SystemOne (booking software) blog", url: "https://www.systemonesoftware.com/blog/radius-clause", note: "Club shows usually 30-50 mi for 30 days either side; \"standard club radius: 100 km (60 miles) / 30 days prior / 15 days post\"." };
const HOWTO: Citation = { title: "What is a Radius Clause?", publisher: "How To Concerts", url: "https://www.howtoconcerts.com/what-is-a-radius-clause/", note: "Suggests 30 mi / 30 days for closed events; larger for ticketed shows." };
const INFRACT: Citation = { title: "Radius clauses: typical terms and fair limits", publisher: "infract handbook", url: "https://infract.at/handbook/guides/radius-clauses", note: "Club shows: the city or 50-150 km, 4-8 weeks before; example measured \"in a straight line\"." };
const LOLLA: Citation = { title: "Attorney General Investigates Lollapalooza", publisher: "Rolling Stone (2010)", url: "https://www.rollingstone.com/music/music-news/attorney-general-investigates-lollapalooza-233557/", note: "Festival-scale clause for contrast: 300 mi, 180 days before and 90 after." };
const ROADI: Citation = { title: "Tour Routing: How to Route a Band Tour", publisher: "Roadi (touring guide)", url: "https://go-roadi.com/resources/learn/tour-routing", note: "Route in one direction or a loop, don't zig-zag; every drive should end at a show." };
const TSENG: Citation = { title: "Effects of Performance Schedules on Event Ticket Sales (PhD dissertation)", publisher: "Tseng, University of Maryland, 2009", url: "http://hdl.handle.net/1903/9683", note: "Ticket data for a touring family show across 42 US markets: weekend performances sell more (Fri avg 8,112 vs Sat 9,552 tickets). Not club shows." };
const AAM: Citation = { title: "Day, duration, and start time: are the arts providing what their audiences require?", publisher: "Arts and the Market 8(1), 2018", url: "https://doi.org/10.1108/aam-12-2017-0027", note: "US conjoint survey: the utility of Saturday attendance is \"overwhelming\" relative to other days." };

const QLOO_HEATMAPS: Citation = { title: "Heatmap Insights", publisher: "Qloo docs", url: "https://docs.qloo.com/reference/heatmaps", note: "Each heatmap point carries affinity, affinity_rank and popularity; affinity is \"a normalized measure\" of local interest." };
/** Live calibration run, 2026-10-21 (aggregates only; see docs/SOURCES.md "Live calibration"). */
const LIVE_2026_10_21 = "Live calibration 2026-10-21 (10 real acts; method in docs/SOURCES.md, measured values kept out of the repo): heatmap cell affinity is a percentile of the cells in each response, and a city read is the best cell near the city, so city reads bunch near 1.";
const OSM_VENUES: Citation = { title: "Overpass API: live-performance venues (amenity=music_venue|nightclub|theatre, live_music=yes)", publisher: "OpenStreetMap contributors (ODbL 1.0)", url: "https://wiki.openstreetmap.org/wiki/Overpass_API", note: "Bulk download 2026-10-19, counted within 10 mi of each market's centre (scripts/data/build_markets.py)." };

export const RULES = {
  maxDriveMi: {
    value: 350, unit: "road mi/day", label: "Max drive per show day (miles)", kind: "assumption", adjustable: true,
    why: "A booking preference, not a law. Measured on OSRM road distances. Touring guides recommend much shorter van drives (2-4 h).",
    sources: [ROADI],
  },
  maxDriveHours: {
    value: 7.5, unit: "h/day", label: "Max drive time per day", kind: "sourced", adjustable: true,
    why: "General driver-fatigue guidance from a government road-safety body; the federal ceiling for hired passenger-vehicle drivers is 10 h. Times are OSRM car-profile, free-flow, with no stops, traffic or trailer, so real van times run longer.",
    sources: [RSS, FMCSA],
  },
  maxConsecutiveShows: {
    value: 6, unit: "shows", label: "Max shows in a row before a day off", kind: "adapted", adjustable: true,
    why: "The AFM's touring agreement for theatrical musicals requires one day off each week, i.e. at most 6 show days in 7. Club tours aren't bound by it; Fanpoint uses it as a default.",
    sources: [AFM, ROADI],
  },
  radiusMi: {
    value: 60, unit: "mi (straight line)", label: "Radius clause around each anchor", kind: "sourced", adjustable: true,
    why: "Industry guides put club-show radius clauses at roughly 30-100 mi for 30-60 days; 60 mi (100 km) is the \"standard club radius\" template. Every fill sits within days of an anchor, so the time window always applies. Measured as a straight line. Real clauses are per contract: check yours.",
    sources: [SYSTEMONE, HOWTO, INFRACT, LOLLA],
  },
  dowWeights: {
    value: [0.7, 0.55, 0.65, 0.75, 0.9, 1.0, 1.0] as const, unit: "Sun..Sat, 0-1", label: "Night-of-week demand weights", kind: "assumption", adjustable: true,
    why: "Research supports the direction (weekend nights draw more), but no public dataset gives club-show weights by night, so the exact values are Fanpoint's.",
    sources: [TSENG, AAM],
  },
  nightFloor: {
    value: 0.45, unit: "heat x weight", label: "A show must beat a night off by", kind: "assumption", adjustable: true,
    why: "A fill is only booked if Qloo fan heat x night weight exceeds this. Lower it to fill more nights. Not retuned on 2026-10-21: with the 0.94 heat floor it no longer refuses any night on its own (0.94 x the lowest weight 0.55 = 0.52), so the weights now only choose which night each city gets. There's no data-based way to map a heat x weight product onto the live scale; raise it if weak weeknights should stay dark.",
    sources: [],
  },
  minAffinity: {
    value: 0.94, unit: "Qloo affinity 0-1", label: "Fan-heat floor", kind: "assumption", adjustable: true,
    why: `Candidates below this Qloo heat value are not considered. Was 0.6, written for city reads spread like percentiles (keep the top 40%). ${LIVE_2026_10_21} 0.94 is set as the 60th percentile of live corridor city reads at the 5 mi read radius, so the floor keeps the same top 40% it was designed to keep.`,
    sources: [QLOO_HEATMAPS],
  },
  holidaysOff: {
    value: 1, unit: "1 = keep off, 0 = allow", label: "Keep major travel holidays off", kind: "assumption", adjustable: true,
    why: "Thanksgiving Day (4th Thursday of November), Christmas Eve and Christmas Day stay off by default: crews travel home, venues close or go dark, and turnout is unreliable. New Year's Eve is not blocked: it is one of the biggest show nights of the year. Fanpoint's default, not a sourced rule; anchors you confirm on these dates are kept.",
    sources: [],
  },
  openerPopularityGap: {
    value: 0.02, unit: "Qloo popularity (0-1)", label: "Run-wide support act: at least this much less popular than the headliner", kind: "assumption", adjustable: false,
    why: "So the support act reads as an opener, not a peer. Qloo popularity is percentile-like (well-known indie acts sit near 0.99), so a small gap already means a clearly smaller act. Fanpoint's judgement.",
    sources: [],
  },
  spacingMi: {
    value: 50, unit: "mi (straight line)", label: "Min spacing between consecutive fills", kind: "assumption", adjustable: false,
    why: "Keeps two consecutive fills from splitting one market's audience.",
    sources: [],
  },
  progressMi: {
    value: 25, unit: "mi", label: "No doubling back: progress towards the next anchor", kind: "assumption", adjustable: false,
    why: "Puts the routing practice \"route in one direction, never zig-zag\" into numbers: each stop must be at least this much closer (straight line) to the next anchor than the last one.",
    sources: [ROADI],
  },
  departMi: {
    value: 10, unit: "mi", label: "No doubling back: distance from the previous anchor", kind: "assumption", adjustable: false,
    why: "...and at least this much further from the previous anchor.",
    sources: [ROADI],
  },
  minVenues: {
    value: 1, unit: "mapped venues within 10 mi", label: "Real venue required", kind: "assumption", adjustable: false,
    why: "A fill needs a room to play. Markets with no live-performance venue mapped in OpenStreetMap within 10 mi are removed in both modes. The count is mapped presence, not an inventory, so this only drops markets with no evidence of a room.",
    sources: [OSM_VENUES],
  },
  corridorBufferMi: {
    value: 90, unit: "mi", label: "Corridor width (each side of the anchor-to-anchor line)", kind: "assumption", adjustable: false,
    why: "How far off the direct line Qloo's heatmap is read. Fixed in code (the model cannot change it).",
    sources: [],
  },
  metroReadRadiusMi: {
    value: 5, unit: "mi", label: "Heat cell to city matching radius (corridor)", kind: "assumption", adjustable: false,
    why: `A city takes the strongest Qloo heat cell within this distance of its centre point (corridor heatmaps, finer grid). Was 25. ${LIVE_2026_10_21} At 25 mi city reads barely separated; 5 mi is the smallest tested radius that still reads at least 98% of corridor cities.`,
    sources: [QLOO_HEATMAPS],
  },
  nationalReadRadiusMi: {
    value: 15, unit: "mi", label: "Heat cell to city matching radius (lower-48 heatmaps)", kind: "assumption", adjustable: false,
    why: `Same read for the co-headliner's lower-48 heatmap, whose grid is coarser than a corridor's. Was 25 (shared with the corridor). ${LIVE_2026_10_21} 15 mi is the smallest tested radius that reads at least 98% of the 385 markets.`,
    sources: [QLOO_HEATMAPS],
  },
  strongThreshold: {
    value: 0.95, unit: "Qloo affinity", label: "Co-headline: \"strong city\" threshold", kind: "assumption", adjustable: false,
    why: `Used for complementarity counts. Was 0.75, meant as an act's top quarter of cities. ${LIVE_2026_10_21} 0.95 is set as the 75th percentile of live lower-48 city reads (15 mi radius), so "strong" again means the top quarter.`, sources: [QLOO_HEATMAPS],
  },
  weakThreshold: {
    value: 0.91, unit: "Qloo affinity", label: "Co-headline: \"weak city\" threshold", kind: "assumption", adjustable: false,
    why: `Used for complementarity counts. Was 0.6, meant as the bottom 60% of cities. ${LIVE_2026_10_21} 0.91 is set as the 60th percentile of live lower-48 city reads (15 mi radius).`, sources: [QLOO_HEATMAPS],
  },
  peerPopularityBand: {
    value: 0.15, unit: "+/- Qloo popularity", label: "Co-headline peers: popularity band", kind: "assumption", adjustable: false,
    why: "A co-headline needs acts of roughly equal draw; peers outside this band are not requested.", sources: [],
  },
  peerCount: {
    value: 8, unit: "acts", label: "Co-headline peers requested", kind: "internal", adjustable: false,
    why: "Bounds Qloo calls per run (one heatmap per peer). Fixed in code; the model cannot change it.", sources: [],
  },
  milePenalty: {
    value: 0.0004, unit: "score per road mi", label: "Tie-break: prefer shorter routes", kind: "internal", adjustable: false,
    why: "Only separates otherwise-equal routes (~0.04 heat points per 100 mi).", sources: [],
  },
  coheadAsymmetryPenalty: {
    value: 0.5, unit: "per city of imbalance", label: "Co-headline: penalty for one-sided deals", kind: "assumption", adjustable: false,
    why: "A co-bill needs both agents to say yes, so a deal where only one act gains is worth less. The weight is Fanpoint's judgement; it changes ordering only when two pairs have similar total gains.",
    sources: [],
  },
  coheadOverlapPenalty: {
    value: 0.25, unit: "per shared strong city", label: "Co-headline: penalty for shared strongholds", kind: "assumption", adjustable: false,
    why: "Cities where both acts are already strong add little new audience. The weight is Fanpoint's judgement.",
    sources: [],
  },
} as const satisfies Record<string, Rule>;
export type RuleKey = keyof typeof RULES;

/** Plain values for code paths. */
export const RULE_VALUES = Object.fromEntries(Object.entries(RULES).map(([k, r]) => [k, r.value])) as { [K in RuleKey]: (typeof RULES)[K]["value"] };

/** Keys the user may override (form + API). */
export const ADJUSTABLE: readonly RuleKey[] = (Object.keys(RULES) as RuleKey[]).filter((k) => RULES[k].adjustable);

export const KIND_LABEL: Record<RuleKind, string> = { sourced: "Sourced", adapted: "Adapted from a source", assumption: "Adjustable assumption", internal: "Implementation detail" };
