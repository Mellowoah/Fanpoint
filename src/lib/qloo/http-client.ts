import "server-only";
import { cacheGet, cacheSet } from "../cache";
import { ProviderError } from "../net/errors";
import { requestWithRetry, type HttpDeps, type RetryPolicy } from "../net/http";
import { checkQlooBaseUrl } from "./base-url";
import { sharedLimiter } from "../net/rate-limiter";
import { countResults, parseDemographics, parseHeatmap, parseInsights, parseInsightsLocal, parseLocalityHeat, parseScoredTags, parseSearch, parseTags, type LocalityHeat, type Parsed } from "./schemas";
import type { Demographics, TagScore } from "./taste";
import { responseHash } from "./hash";
import { cleanParams, type HeatCell, type LocalInsights, type QlooCallLog, type QlooClient, type QlooParams, type QlooRawEntity } from "./types";

export interface QlooHttpOptions {
  retry: RetryPolicy;
  /** Exact non-standard base URL the operator has approved (QLOO_TRUSTED_BASE_URL). */
  trustedBaseUrl?: string;
  /**
   * Minimum spacing between request starts (shared per base URL). Neither the hackathon kit nor the developer
   * guide publishes a number ("rate and monthly quota limits set high enough"; organizers announce them), so
   * 220 ms (~4.5 req/s) is a conservative self-imposed ceiling, not a documented limit.
   */
  minIntervalMs: number;
  /** Safety cap on network calls per client instance (one instance = one agent run). Protects the monthly quota. */
  maxCallsPerRun: number;
}
/**
 * Retry policy aligned with Qloo's own client (@qloo/qloo-harness 0.1.26): 3 attempts in total, 20 s per attempt,
 * retry only 429/500/502/503/504 (honoring Retry-After), 5 MB response cap.
 */
export const QLOO_RETRY_STATUS: ReadonlySet<number> = new Set([429, 500, 502, 503, 504]);
export const DEFAULT_QLOO_OPTIONS: QlooHttpOptions = {
  retry: { retries: 2, baseDelayMs: 400, maxDelayMs: 10_000, timeoutMs: 20_000, retryOn: QLOO_RETRY_STATUS, maxBodyBytes: 5 * 1024 * 1024 },
  minIntervalMs: 220,
  maxCallsPerRun: 150,
};
/**
 * Locality heatmaps carry every matched locality's full boundary, the country's included: 5.5-16 MB per response in
 * live tests. Only this call may read that much; the geometry is reduced to centre points before anything is cached.
 */
export const LOCALITY_HEAT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Live adapter for the Qloo hackathon API.
 * Per the Qloo hackathon developer guide (and matching Qloo's harness client): header `X-Api-Key`, every endpoint
 * is GET with query-string params: /v2/insights, /search (query, types, take), /v2/tags (filter.query, ...).
 * Base URL defaults to https://hackathon.api.qloo.com (the guide says hackathon keys 401 anywhere else).
 * Every response is schema-validated (./schemas.ts); invalid items are dropped and counted in the call log.
 */
export class HttpQlooClient implements QlooClient {
  readonly mode = "live" as const;
  readonly calls: QlooCallLog[] = [];
  private network = 0;
  private readonly opts: QlooHttpOptions;
  private readonly deps: HttpDeps;

  constructor(private readonly apiKey: string, private readonly baseUrl: string, opts: Partial<QlooHttpOptions> = {}, deps: HttpDeps = {}) {
    this.opts = { ...DEFAULT_QLOO_OPTIONS, ...opts };
    const check = checkQlooBaseUrl(baseUrl, this.opts.trustedBaseUrl);
    // Refuse before any request: the key must never be sent to an unapproved host.
    if (!check.ok) throw new ProviderError("qloo", "config", `QLOO_BASE_URL ${check.reason}`);
    if (!apiKey.trim()) throw new ProviderError("qloo", "config", "QLOO_API_KEY is empty");
    this.baseUrl = check.url;
    this.deps = { limiter: sharedLimiter(`qloo:${this.baseUrl}`, this.opts.minIntervalMs), ...deps };
  }

  /** GET + validate. Cache stores the *parsed* result, so a cached hit can never be an invalid body. */
  private async get<T>(path: string, params: QlooParams, parse: (json: unknown) => Parsed<T>, retry: Partial<RetryPolicy> = {}): Promise<T[]> {
    const clean = cleanParams(params);
    const qs = new URLSearchParams(clean).toString();
    const key = `qloo:${this.baseUrl}${path}?${qs}`;
    const cached = cacheGet<T[]>(key);
    if (cached) {
      this.calls.push({ endpoint: path, params: clean, ms: 0, status: "cache", resultCount: cached.length, responseHash: cacheGet<string>(`${key}#hash`) });
      return cached;
    }
    if (this.network >= this.opts.maxCallsPerRun) {
      this.calls.push({ endpoint: path, params: clean, ms: 0, status: "error", resultCount: 0, error: "budget" });
      throw new ProviderError("qloo", "budget", `more than ${this.opts.maxCallsPerRun} Qloo calls in one run`);
    }
    this.network++;
    const t0 = Date.now();
    try {
      const res = await requestWithRetry("qloo", `${this.baseUrl}${path}?${qs}`, {
        method: "GET", headers: { "X-Api-Key": this.apiKey, accept: "application/json", "user-agent": "routed/0.1" }, cache: "no-store",
      }, { ...this.opts.retry, ...retry }, this.deps);
      let json: unknown;
      try { json = JSON.parse(res.text); } catch { throw new ProviderError("qloo", "invalid_response", `${path}: body is not JSON`, res.status, res.attempts); }
      const parsed = parse(json);
      const hash = responseHash(res.text);
      this.calls.push({ endpoint: path, params: clean, ms: res.ms, status: res.status, resultCount: countResults(json), dropped: parsed.dropped || undefined, attempts: res.attempts, responseHash: hash });
      cacheSet(key, parsed.items);
      cacheSet(`${key}#hash`, hash);
      return parsed.items;
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError("qloo", "network", (e as Error).message);
      this.calls.push({ endpoint: path, params: clean, ms: Date.now() - t0, status: pe.status ?? "error", resultCount: 0, attempts: pe.attempts, error: pe.code });
      throw pe;
    }
  }

  async search(query: string, types: string[], take = 5): Promise<QlooRawEntity[]> {
    try {
      return await this.get("/search", { query, types: types.join(","), take }, parseSearch);
    } catch (e) {
      if (e instanceof ProviderError && e.code === "not_found") return []; // /search answers 404 for "no results"
      throw e;
    }
  }

  insights(params: QlooParams): Promise<QlooRawEntity[]> {
    return this.get("/v2/insights", params, parseInsights);
  }

  async insightsLocal(params: QlooParams): Promise<LocalInsights> {
    return (await this.get("/v2/insights", params, parseInsightsLocal))[0] ?? { entities: [] };
  }

  async heatmap(params: QlooParams): Promise<HeatCell[]> {
    const cells = await this.get("/v2/insights", { ...params, "filter.type": "urn:heatmap" }, parseHeatmap);
    return cells.map((c) => ({
      lat: c.location.latitude, lon: c.location.longitude, geohash: c.location.geohash,
      affinity: c.query.affinity, affinityRank: c.query.affinity_rank, popularity: c.query.popularity, mock: false,
    }));
  }

  localityHeat(params: QlooParams): Promise<LocalityHeat[]> {
    return this.get("/v2/insights", { ...params, "filter.type": "urn:heatmap", "output.heatmap.boundary": "urn:entity:locality" }, parseLocalityHeat, { maxBodyBytes: LOCALITY_HEAT_MAX_BYTES });
  }

  demographics(entityIds: string[]): Promise<Demographics[]> {
    return this.get("/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": entityIds.join(",") }, parseDemographics);
  }

  tagInsights(params: QlooParams): Promise<TagScore[]> {
    return this.get("/v2/insights", { ...params, "filter.type": "urn:tag" }, parseScoredTags);
  }

  compare(a: string, b: string): Promise<TagScore[]> {
    return this.get("/v2/analysis/compare", { "a.signal.interests.entities": a, "b.signal.interests.entities": b, take: 30 }, parseScoredTags);
  }

  tags(query: string, tagTypes?: string[]): Promise<{ id: string; name: string }[]> {
    return this.get("/v2/tags", { "filter.query": query, "filter.tag.types": tagTypes?.join(","), take: 10 }, parseTags);
  }
}
