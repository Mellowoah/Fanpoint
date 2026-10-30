/**
 * Ad launch packs: ready-to-review ad drafts for one stop on Meta (Facebook + Instagram), X and Snapchat.
 * Deterministic and client-safe: no LLM call, no network, nothing posted or spent. Every interest comes from a Qloo
 * result already in the plan (cross-domain taste, promo picks, the local opener) and keeps its receipt.
 *
 * Honest limits: Qloo taste data is aggregate (what an audience likes), not a list of people. Platform interest
 * taxonomies can't be checked without each platform's ads API, so every interest is a plain keyword to look up
 * ("verify in Ads Manager"). No reach, CPM or conversion numbers: budget fields are the user's own inputs.
 */
import type { FillPlan, FillStop } from "@/lib/agent/types";
import type { Entity } from "@/lib/qloo/types";
import { XD_META, isFashionBrand, type XdKey } from "@/lib/qloo/crossdomain";
import { cityLabel } from "@/lib/route/city-label";

export type Platform = "meta" | "x" | "snap";
export const PLATFORMS: readonly Platform[] = ["meta", "x", "snap"];
export const PLATFORM_LABEL: Record<Platform, string> = { meta: "Meta (Facebook + Instagram)", x: "X", snap: "Snapchat" };
export const PLATFORM_SHORT: Record<Platform, string> = { meta: "Meta", x: "X", snap: "Snapchat" };
/** Official ads tools, opened in a new tab. Fanpoint never signs in or calls them. */
export const ADS_MANAGER: Record<Platform, string> = {
  meta: "https://adsmanager.facebook.com/",
  x: "https://ads.x.com/",
  snap: "https://ads.snapchat.com/",
};

/** Character limits per field (Meta: recommended lengths; X: post limit; Snapchat: hard limits). */
export const LIMITS = { metaPrimary: 125, metaHeadline: 40, xPost: 280, snapHeadline: 34, snapBrand: 25 } as const;
export const IMAGE_SIZES: Record<Platform, string[]> = {
  meta: ["1080×1080 (Feed, 1:1)", "1080×1920 (Stories and Reels, 9:16)"],
  x: ["1080×1080 (1:1)", "1200×675 (16:9)"],
  snap: ["1080×1920 (9:16, full screen)"],
};
export const DEFAULT_RADIUS_MI = 25;
export const LEAD_DAYS = 14;
export const MIN_AGE = 18;
export const MAX_INTERESTS = 10;
export const NOTICE = "Nothing is posted or spent by Fanpoint. You launch in each platform after review.";
export const STATUS = "Draft — ready for review";
export const VERIFY = "verify in Ads Manager";

/** Where an interest came from in the plan. */
export type InterestSource = XdKey | "music" | "opener";
export interface AdInterest {
  name: string;
  source: InterestSource;
  /** Qloo entity id and kind: the receipt. */
  entityId: string; kind: Entity["kind"];
  /** Qloo affinity, 0–100 (undefined when Qloo gave none). */
  affinity?: number;
  /** Position in Qloo's list for that category in this city (1 = top). */
  rank?: number;
  /** How to enter it on each platform: a plain keyword or a category to look up. */
  platform: Record<Platform, string>;
}
export interface Excluded { name: string; reason: string; entityId: string }

/** Sensitive or restricted topics never used for targeting (Meta, X and Snapchat restrict these; Fanpoint drops them). */
const SENSITIVE: { reason: string; re: RegExp }[] = [
  { reason: "politics", re: /\b(politic\w*|election\w*|democrat\w*|republican\w*|congress\w*|senat(e|or)\w*|partisan|government|president\w*|activis[mt]\w*|campaign for)\b/i },
  { reason: "religion", re: /\b(relig\w*|church\w*|christian\w*|catholic\w*|bible|biblical|gospel|worship\w*|faith|islam\w*|muslim\w*|jewish|judaism|hindu\w*|buddhis\w*|spiritual\w*|prayer\w*|ministr(y|ies))\b/i },
  { reason: "health", re: /\b(health\w*|medical|medicine|disease\w*|cancer|diabet\w*|mental|therap\w*|depress\w*|anxiety|addict\w*|pharma\w*|weight[ -]loss|dieting|fertility|pregnan\w*|disabilit\w*|hospital\w*|wellness)\b/i },
  { reason: "sexual orientation or gender identity", re: /\b(lgbt\w*|gay|lesbian\w*|queer|bisexual\w*|transgender\w*|sexual\w*|sex)\b/i },
  { reason: "race or ethnicity", re: /\b(ethnic\w*|racial|race|african[- ]american\w*|hispanic\w*|latin[oax]s?|asian[- ]american\w*|native american\w*)\b/i },
  { reason: "personal finances", re: /\b(financ\w*|credit|debt\w*|loans?|mortgage\w*|bankrupt\w*|invest\w*|crypto\w*|bitcoin|insurance)\b/i },
  { reason: "age-restricted product", re: /\b(alcohol\w*|beer\w*|wines?|winery|vodka|whiske?y|bourbon|tequila|liquor\w*|brewer(y|ies)|casino\w*|gambl\w*|betting|sportsbook\w*|tobacco|cigar\w*|vap(e|es|ing)|cannabis|marijuana|firearms?|ammunition)\b/i },
];

/** Why an entity must not be used for targeting, or undefined if it's fine. Checks Qloo's name and tags (and a person's description). */
export function sensitiveReason(e: Pick<Entity, "name" | "tags" | "kind" | "description">): string | undefined {
  const text = [e.name, ...e.tags, e.kind === "person" ? (e.description ?? "") : ""].join(" · ");
  return SENSITIVE.find((s) => s.re.test(text))?.reason;
}

/** Closest Snapchat lifestyle-style audience for each source (names vary in Ads Manager, so these are look-ups). */
const SNAP_CATEGORY: Record<InterestSource, string> = {
  music: "music fans", opener: "music fans", brands: "shoppers", podcasts: "podcast listeners", dining: "foodies",
  tv: "TV fans", film: "movie fans", books: "book readers", games: "gamers", people: "pop culture fans", travel: "travelers",
};
const SOURCE_LABEL: Record<InterestSource, string> = {
  ...Object.fromEntries(Object.entries(XD_META).map(([k, v]) => [k, v.label])) as Record<XdKey, string>,
  music: "Music (your artist)", opener: "Music (local opener)",
};
export const sourceLabel = (s: InterestSource) => SOURCE_LABEL[s];

/** Plain-keyword versions of a Qloo name for each platform. */
export function mapInterest(name: string, source: InterestSource, e?: Pick<Entity, "kind" | "tags">): Record<Platform, string> {
  const clean = name.replace(/\s+/g, " ").trim();
  const snap = source === "brands" && e && isFashionBrand(e.tags) ? "fashion & style" : SNAP_CATEGORY[source];
  return { meta: clean, x: `"${clean.toLowerCase()}"`, snap: `${snap} (${clean})` };
}

const pct = (a?: number) => (a === undefined ? undefined : Math.round(a * 100));

/**
 * The stop's targeting interests: the artist, the local opener, the promo picks and every cross-domain category except
 * dining (restaurants are places, not interests: they're listed as local partners instead) and travel (places these fans
 * like to visit, not an interest to target). Deduped by Qloo id,
 * sensitive topics dropped (and reported), strongest affinity first; the artist always first.
 */
export function stopInterests(q: FillPlan, s: FillStop, max = MAX_INTERESTS): { interests: AdInterest[]; excluded: Excluded[] } {
  type C = { e: Entity; source: InterestSource; rank?: number };
  const cands: C[] = [
    { e: q.artist, source: "music" },
    ...s.support.slice(0, 1).map((e) => ({ e, source: "opener" as const, rank: 1 })),
    ...s.promo.map((p, i) => ({ e: p.entity, source: (p.entity.kind === "podcast" ? "podcasts" : p.entity.kind === "tv_show" ? "tv" : "brands") as InterestSource, rank: i + 1 })),
    ...(s.alsoLike ?? []).filter((r) => r.key !== "dining" && r.key !== "travel").flatMap((r) => r.items.map((e, i) => ({ e, source: r.key as InterestSource, rank: i + 1 }))),
  ];
  const seen = new Set<string>(), seenName = new Set<string>();
  const excluded: Excluded[] = [];
  const out: (AdInterest & { order: number })[] = [];
  cands.forEach((c, order) => {
    const key = c.e.name.trim().toLowerCase();
    if (seen.has(c.e.id) || seenName.has(key) || !key) return;
    seen.add(c.e.id); seenName.add(key);
    const reason = sensitiveReason(c.e);
    if (reason) { excluded.push({ name: c.e.name, reason, entityId: c.e.id }); return; }
    out.push({ name: c.e.name.trim(), source: c.source, entityId: c.e.id, kind: c.e.kind, affinity: c.source === "music" ? undefined : pct(c.e.affinity), rank: c.rank, platform: mapInterest(c.e.name, c.source, c.e), order });
  });
  const [artist, ...rest] = out;
  rest.sort((a, b) => (b.affinity ?? -1) - (a.affinity ?? -1) || a.order - b.order);
  const interests = (artist?.source === "music" ? [artist, ...rest] : out).slice(0, max).map(({ order: _o, ...i }) => i);
  return { interests, excluded };
}

/** X counts every link as 23 characters and most CJK / emoji as 2 (twitter-text weighting, simplified). */
export function xLength(t: string): number {
  const noUrls = t.replace(/https?:\/\/\S+/g, "");
  const urls = (t.match(/https?:\/\/\S+/g) ?? []).length;
  let n = urls * 23;
  for (const ch of noUrls) { const c = ch.codePointAt(0)!; n += c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037) ? 1 : 2; }
  return n;
}
export const charCount = (t: string, p: Platform) => (p === "x" ? xLength(t) : [...t].length);

/** The first candidate within `limit` characters; otherwise the shortest one cut at a word with "…". */
export function fit(cands: string[], limit: number, count: (t: string) => number = (t) => [...t].length): string {
  const ok = cands.find((c) => count(c) <= limit);
  if (ok !== undefined) return ok;
  const s = [...cands].sort((a, b) => count(a) - count(b))[0] ?? "";
  const chars = [...s];
  let cut = chars.slice(0, limit - 1).join("");
  const sp = cut.lastIndexOf(" ");
  if (sp > limit * 0.5) cut = cut.slice(0, sp);
  return cut.replace(/[\s,.;:·–-]+$/, "") + "…";
}

export interface AdCreative { field: string; text: string; limit: number; hard: boolean }
export interface AdPack {
  status: typeof STATUS; notice: typeof NOTICE;
  artist: string; date: string; city: string; venue?: string; venueAddress?: string;
  audience: {
    location: { label: string; lat: number; lon: number; radiusMi: number; center: "venue" | "city" };
    start: string; end: string; minAge: number;
    interests: AdInterest[]; excluded: Excluded[];
    /** Qloo dining picks near the stop: partner ideas, never targeting. */
    localPartners: string[];
  };
  hook?: AdInterest;
  /** AI-written promo idea already in the plan (labelled AI), when there is one. */
  aiAngle?: { name: string; text: string };
  creative: Record<Platform, AdCreative[]>;
  cta: Record<Platform, string>;
  images: Record<Platform, string[]>;
  xIntent: string;
}

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const dowDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
export function minusDays(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10);
}

/** Builds one stop's pack. `ticketUrl` is the user's own link (optional; nothing is invented when it's empty). */
export function buildAdPack(q: FillPlan, s: FillStop, opts: { ticketUrl?: string; radiusMi?: number } = {}): AdPack {
  const { interests, excluded } = stopInterests(q, s);
  const v = s.venues[0];
  const artist = q.artist.name.trim();
  const city = s.city.replace(/,.*$/, "");
  const where = v ? `${v.name} in ${city}` : city;
  const date = shortDate(s.date), dd = dowDate(s.date);
  const hook = interests.find((i) => i.source !== "music" && i.source !== "opener") ?? interests.find((i) => i.source !== "music");
  const also = hook ? ` Fans here also love ${hook.name}.` : "";
  const alsoShort = hook ? ` Fans here love ${hook.name} too.` : "";
  const url = opts.ticketUrl?.trim() && /^https?:\/\/\S+$/i.test(opts.ticketUrl.trim()) ? opts.ticketUrl.trim() : "";
  const metaPrimary = fit([
    `${artist} live at ${where}, ${dd}.${also} Get your tickets now.`,
    `${artist} live at ${where}, ${date}.${alsoShort} Tickets on sale.`,
    `${artist} live in ${city}, ${date}.${alsoShort}`,
    `${artist} live in ${city}, ${date}. Get your tickets now.`,
  ], LIMITS.metaPrimary);
  const metaHeadline = fit([`${artist} · ${city} · ${date}`, `${artist} · ${date}`, artist], LIMITS.metaHeadline);
  const xPost = fit([
    `${artist} live at ${where}, ${dd}.${also}${url ? ` Tickets: ${url}` : ""}`,
    `${artist} live in ${city}, ${date}.${alsoShort}${url ? ` ${url}` : ""}`,
  ], LIMITS.xPost, xLength);
  const snapHeadline = fit([`${artist} live in ${city} ${date}`, `${artist} · ${city} · ${date}`, `${artist} · ${date}`, artist], LIMITS.snapHeadline);
  const snapBrand = fit([artist], LIMITS.snapBrand);
  const ai = s.promo.find((p) => p.angleBy === "ai" && !sensitiveReason(p.entity));
  const center = v?.lat !== undefined && v?.lon !== undefined ? { lat: v.lat, lon: v.lon, c: "venue" as const } : { lat: s.lat, lon: s.lon, c: "city" as const };
  const radiusMi = opts.radiusMi ?? DEFAULT_RADIUS_MI;
  return {
    status: STATUS, notice: NOTICE, artist, date: s.date, city: cityLabel(s.city, s.region), venue: v?.name, venueAddress: v?.place?.address,
    audience: {
      location: { label: `${radiusMi} mi around ${v ? `${v.name}, ` : ""}${cityLabel(s.city, s.region)}`, lat: +center.lat.toFixed(4), lon: +center.lon.toFixed(4), radiusMi, center: center.c },
      start: minusDays(s.date, LEAD_DAYS), end: s.date, minAge: MIN_AGE, interests, excluded,
      localPartners: (s.alsoLike ?? []).filter((r) => r.key === "dining").flatMap((r) => r.items.map((e) => e.name)),
    },
    hook,
    aiAngle: ai ? { name: ai.entity.name, text: ai.angle } : undefined,
    creative: {
      meta: [{ field: "Primary text", text: metaPrimary, limit: LIMITS.metaPrimary, hard: false }, { field: "Headline", text: metaHeadline, limit: LIMITS.metaHeadline, hard: false }],
      x: [{ field: "Post", text: xPost, limit: LIMITS.xPost, hard: true }],
      snap: [{ field: "Brand name", text: snapBrand, limit: LIMITS.snapBrand, hard: true }, { field: "Headline", text: snapHeadline, limit: LIMITS.snapHeadline, hard: true }],
    },
    cta: { meta: "Buy Tickets", x: url ? "Link in post" : "Add your ticket link", snap: "Learn More" },
    images: IMAGE_SIZES,
    xIntent: `https://x.com/intent/post?text=${encodeURIComponent(xPost)}`,
  };
}

/** Plain-text version of a pack for the clipboard. */
export function packText(p: AdPack, budget?: BudgetInputs): string {
  const a = p.audience;
  const lines = [
    `AD LAUNCH PACK · ${p.artist} · ${p.city} · ${p.date}${p.venue ? ` · ${p.venue}` : ""}`,
    `Status: ${p.status}. ${p.notice}`,
    "",
    "AUDIENCE (all platforms)",
    `Location: ${a.location.label} (${a.location.lat}, ${a.location.lon})`,
    `Dates: ${a.start} to ${a.end} · Ages ${a.minAge}+`,
    `Interests (Qloo taste data for this city's fans; aggregate, not individuals; ${VERIFY}):`,
    ...a.interests.map((i) => `- ${i.name} · ${receipt(i)}`),
    ...(a.excluded.length ? [`Left out (sensitive or restricted topics): ${a.excluded.map((e) => `${e.name} (${e.reason})`).join(", ")}`] : []),
    ...(a.localPartners.length ? [`Local partner ideas, not targeting: ${a.localPartners.join(", ")}`] : []),
  ];
  for (const pl of PLATFORMS) {
    lines.push("", PLATFORM_LABEL[pl].toUpperCase());
    for (const c of p.creative[pl]) lines.push(`${c.field} (${charCount(c.text, pl)}/${c.limit}): ${c.text}`);
    lines.push(`Call to action: ${p.cta[pl]}`, `Images: ${p.images[pl].join("; ")}`, `Targeting: ${a.interests.map((i) => i.platform[pl]).join(", ")}`, `Launch: ${ADS_MANAGER[pl]}`);
  }
  if (p.aiAngle) lines.push("", `Promo idea (AI-written, from the plan): ${p.aiAngle.name}: ${p.aiAngle.text}`);
  if (budget) { const t = budgetTotal(budget); lines.push("", `Budget (your numbers, not Qloo data): ${t === undefined ? "not set" : `${usd2(budget.daily)}/day × ${budget.days} days = ${usd2(t)} per platform`}`); }
  return lines.join("\n");
}

export function receipt(i: AdInterest): string {
  if (i.source === "music") return `your artist (Qloo id ${i.entityId})`;
  return `Qloo ${sourceLabel(i.source)}${i.rank ? ` #${i.rank}` : ""}${i.affinity !== undefined ? ` · affinity ${i.affinity}` : ""} · id ${i.entityId}`;
}

// ---------- Budget (user inputs only) ----------
export interface BudgetInputs { daily: number; days: number }
export const BUDGET_DEFAULTS: BudgetInputs = { daily: 0, days: LEAD_DAYS };
/** daily × days, or undefined when either is missing. Never a Qloo number. */
export function budgetTotal(b: BudgetInputs): number | undefined {
  const d = Number.isFinite(b.daily) && b.daily > 0 ? b.daily : 0, n = Number.isFinite(b.days) && b.days > 0 ? Math.floor(b.days) : 0;
  return d && n ? Math.round(d * n * 100) / 100 : undefined;
}
export const usd2 = (x: number) => `$${x.toLocaleString("en-US", { minimumFractionDigits: x % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

// ---------- Export ----------
/** CSV cell: quoted when needed, and spreadsheet formulas neutralised (=, +, -, @, tab, CR at the start). */
export function csvCell(v: unknown): string {
  const s = v === undefined || v === null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
export const PACK_CSV_HEADER = ["date", "city", "venue", "platform", "section", "field", "value", "chars", "limit", "qloo_source"] as const;

export function packRows(p: AdPack, budget?: BudgetInputs): (string | number | undefined)[][] {
  const base = [p.date, p.city, p.venue];
  const a = p.audience;
  const rows: (string | number | undefined)[][] = [
    [...base, "all", "status", "status", `${p.status}. ${p.notice}`],
    [...base, "all", "audience", "location", a.location.label, , , `${a.location.lat}, ${a.location.lon}`],
    [...base, "all", "audience", "dates", `${a.start} to ${a.end}`],
    [...base, "all", "audience", "min_age", a.minAge],
  ];
  for (const pl of PLATFORMS) {
    for (const i of a.interests) rows.push([...base, pl, "audience", "interest", i.platform[pl], , , `${receipt(i)} (${VERIFY})`]);
    for (const c of p.creative[pl]) rows.push([...base, pl, "creative", c.field, c.text, charCount(c.text, pl), c.limit]);
    rows.push([...base, pl, "creative", "call_to_action", p.cta[pl]], [...base, pl, "creative", "image_sizes", p.images[pl].join("; ")], [...base, pl, "launch", "ads_manager", ADS_MANAGER[pl]]);
  }
  for (const e of a.excluded) rows.push([...base, "all", "excluded", e.reason, e.name, , , `Qloo id ${e.entityId}`]);
  if (p.aiAngle) rows.push([...base, "all", "notes", "promo_idea_ai_written", `${p.aiAngle.name}: ${p.aiAngle.text}`]);
  if (budget) { const t = budgetTotal(budget); rows.push([...base, "all", "budget", "your_numbers_not_qloo", t === undefined ? "not set" : `${budget.daily}/day x ${budget.days} days = ${t} per platform`]); }
  return rows;
}
export function packsCsv(packs: AdPack[], budget?: BudgetInputs): string {
  return [PACK_CSV_HEADER.join(","), ...packs.flatMap((p) => packRows(p, budget).map((r) => Array.from({ length: PACK_CSV_HEADER.length }, (_, i) => csvCell(r[i])).join(",")))].join("\r\n") + "\r\n";
}
export function packsJson(packs: AdPack[], budget?: BudgetInputs): string {
  return JSON.stringify({
    generatedBy: "Fanpoint ad launch packs", status: STATUS, notice: NOTICE,
    dataNote: "Interests are Qloo aggregate taste data for each city's fans (not individuals). Platform interest names are plain keywords: verify in Ads Manager. No reach, CPM or conversion estimates.",
    budget: budget ? { daily: budget.daily || null, days: budget.days || null, totalPerPlatform: budgetTotal(budget) ?? null, note: "Your numbers, not Qloo data" } : null,
    packs,
  }, null, 2);
}

export function packSlug(q: FillPlan, s?: FillStop): string {
  const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `fanpoint-ads-${slug(q.artist.name) || "tour"}${s ? `-${slug(s.city)}-${s.date}` : "-all-stops"}`;
}
export function download(name: string, text: string, type: string) {
  const blob = new Blob([type.startsWith("text/csv") ? "\ufeff" + text : text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
