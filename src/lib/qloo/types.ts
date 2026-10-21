import type { ErrorCode } from "../net/errors";
export type { QlooRawEntity, QlooRawHeatCell } from "./schemas";
import type { QlooRawEntity } from "./schemas";

export type QlooParams = Record<string, string | number | boolean | undefined>;

/** One Qloo request as shown in the agent trace. */
export interface QlooCallLog {
  endpoint: string;
  params: Record<string, string>;
  ms: number;
  /** HTTP status, "mock" for fixtures, "cache" for a private in-memory cache hit, "error" when no response. */
  status: number | "mock" | "cache" | "error";
  resultCount: number;
  /** Items that failed schema validation and were dropped. */
  dropped?: number;
  attempts?: number;
  error?: ErrorCode;
  /** sha256 (16 hex) of the raw response body (live) or of the synthesized mock response. Never the data itself. */
  responseHash?: string;
}

/** Normalized entity used by the agent + UI. */
export interface Entity {
  id: string;
  name: string;
  kind: "artist" | "destination" | "place" | "brand" | "podcast" | "tv_show" | "other";
  /** 0..1, from query.affinity */
  affinity?: number;
  /** 0..1 */
  popularity?: number;
  lat?: number;
  lon?: number;
  city?: string;
  region?: string;
  country?: string;
  description?: string;
  tags: string[];
  mock: boolean;
}

/** One heatmap grid point (GET /v2/insights?filter.type=urn:heatmap -> results.heatmap[]), normalized. */
export interface HeatCell { lat: number; lon: number; geohash?: string; affinity: number; affinityRank?: number; popularity?: number; mock: boolean }

/** Entities from /v2/insights with the matched locality, when Qloo reports one. */
export interface LocalInsights { entities: QlooRawEntity[]; locality?: { name: string; lat?: number; lon?: number } }

export interface QlooClient {
  readonly mode: "live" | "mock";
  search(query: string, types: string[], take?: number): Promise<QlooRawEntity[]>;
  insights(params: QlooParams): Promise<QlooRawEntity[]>;
  tags(query: string, tagTypes?: string[]): Promise<{ id: string; name: string }[]>;
  /**
   * /v2/insights plus the locality Qloo matched for `signal.location.query` (response `query.localities.signal`),
   * so callers can check the fuzzy match against the city they meant.
   */
  insightsLocal(params: QlooParams): Promise<LocalInsights>;
  /** filter.type=urn:heatmap. Returns grid cells; `take` is ignored by Qloo for heatmaps. */
  heatmap(params: QlooParams): Promise<HeatCell[]>;
  /** Every request made through this client instance, in order (for the trace). */
  readonly calls: QlooCallLog[];
}

/** Drop undefined/empty params and stringify the rest (shared by live + mock so the trace is identical). */
export function cleanParams(params: QlooParams): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") clean[k] = String(v);
  return clean;
}
