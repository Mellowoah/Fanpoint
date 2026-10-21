/** Wire types shared by the server (agent) and the browser (UI). Type-only: safe to import from client components. */
import type { Complementarity } from "../cohead/complementarity";
import type { ErrorCode } from "../net/errors";
import type { Entity, QlooCallLog } from "../qloo/types";
import type { CityHeat } from "../qloo/heat";
import type { Anchor, AuditRow as FillAuditRow, FillParams, FillResult } from "../route/fill";
import type { LatLon } from "../route/geo";
import type { GroundingReport } from "./grounding";
import type { RoadMatrixMeta } from "../route/road";
import type { RankedGap } from "../route/rank";
import type { FanHood } from "../qloo/venues";
import type { Demographics, TagScore } from "../qloo/taste";

/** Overrides for adjustable touring assumptions (validated in api/plan-request.ts). */
export interface RuleOverrides { maxDriveHours?: number; maxConsecutiveShows?: number; radiusMi?: number; nightFloor?: number; dowWeights?: number[] }

export interface AnchorInput { city: string; date: string; label?: string }
export interface FillRequest { task: "fill"; artist: string; anchors: AnchorInput[]; maxDriveMi: number; minAffinity: number; rules?: RuleOverrides }
export interface CoheadRequest { task: "cohead"; artist: string; partner?: string }
export type PlanRequest = FillRequest | CoheadRequest;

export type Providers = { qloo: "live" | "mock"; llm: "live" | "mock"; model: string };

export interface Corridor {
  from: string; to: string; ring: LatLon[];
  /** [lat, lon, affinity], strongest first, downsampled for the browser. */
  cells: [number, number, number][];
  candidates: (CityHeat & { rank: number })[];
  /** Where the city ranking came from: the heatmap, the destination fallback, or nothing (Qloo failed / empty). */
  source: "heatmap" | "destination" | "none";
}

export interface FillStop {
  date: string; dow: string; city: string; cityId?: string; region?: string; lat: number; lon: number;
  affinity: number; rankInCorridor?: number; corridorSize?: number; dowWeight: number;
  /** Road leg from the previous show (OSRM road distance and drive time). */
  driveMi: number; driveHours?: number; driveDays: number; prevCity: string;
  /** Show days in a row up to and including this one. */
  run?: number;
  /** Deterministic, built from the data above. */
  headline: string; why: string;
  /** Model-written note, shown labelled as AI text; only kept if every number in it matches the data. */
  aiNote?: string;
  /** Qloo results, top-ranked first (chosen by code, not by the model). */
  support: Entity[]; venues: Entity[]; promo: { entity: Entity; angle: string; angleBy: "ai" | "routed" }[];
  /** Neighborhoods of the stop city where the artist's fans cluster (Qloo locality heat), strongest first. */
  neighborhoods?: FanHood[];
  /** Why the top room (venues[0]) was picked, built from the data. */
  room?: RoomNote;
}
export interface RoomNote {
  /** Great-circle miles from the stop's city centre. */
  mi?: number;
  /** A fan neighborhood the room is in (Qloo names it) or within HOOD_NEAR_MI of. */
  hood?: { name: string; how: "named" | "near"; mi?: number };
  why: string;
}
export interface FillPlan {
  task: "fill"; mode: "qloo"; artist: Entity; anchors: Anchor[]; params: FillParams; result: FillResult; stops: FillStop[];
  corridors: Corridor[];
  /** Ranked gap-city lists, With Qloo (affinity) and Without Qloo (population/venues proxy), same hard-filtered set. */
  ranked: RankedGap[];
  /** Snapshot of every rule value used (touring/rules.ts), so a saved plan is self-describing. */
  rules: RuleSnapshot;
  /** Deterministic summary of the result; `aiSummary` is the model's, kept only if its numbers check out. */
  summary: string; aiSummary?: string;
  routing: RoadMatrixMeta; grounding: GroundingReport; warnings: string[];
  qlooCalls: QlooCallLog[]; providers: Providers;
}
export interface PlainStop { date: string; city: string; id?: string; region?: string; lat?: number; lon?: number; venue: string; why: string }
export interface AuditRow extends FillAuditRow { mapped: boolean }
export interface PlainFillPlan {
  task: "fill"; mode: "plain"; artist: string; anchors: Anchor[]; params: FillParams; stops: PlainStop[]; audit: AuditRow[]; routing: RoadMatrixMeta;
  summary: string; providers: { llm: "live" | "mock"; model: string }; simulated: boolean; warnings: string[];
  /** Longest run of consecutive show days, anchors included. */
  longestRun?: number;
}

export type RuleSnapshot = Record<string, number | readonly number[]>;

export interface PeerMatch extends Complementarity {
  entity: Entity; similarity?: number; picked: boolean; pitch?: string; requested?: boolean;
  /** Taste tags both audiences share (Qloo compare, de-noised). */
  shared?: TagScore[];
  /** Relative age / gender skews of this peer's audience. */
  skew?: Demographics;
  /** Best room for the pair in their best shared city (both acts as the signal). */
  joint?: { city: string; region: string; you: number; them: number; venue?: Entity };
}
/** Co-headliner extras fetched after compare_fan_geography for the recommended peers and the partner. */
export interface CoheadExtras {
  skews: Record<string, Demographics>;
  byPeer: Record<string, { shared: TagScore[]; joint?: NonNullable<PeerMatch["joint"]> }>;
}
export interface CoheadPlan {
  task: "cohead"; artist: Entity; peers: PeerMatch[];
  /** Relative age / gender skews of the artist's own audience. */
  artistSkew?: Demographics;
  thresholds: { strong: number; weak: number }; rules: RuleSnapshot;
  /** Per touring city: your heat and each peer's (null = no Qloo reading for that peer there). */
  cities: { name: string; region: string; lat: number; lon: number; you: number; peers: Record<string, number | null> }[];
  summary: string; aiSummary?: string; grounding: GroundingReport; warnings: string[]; qlooCalls: QlooCallLog[]; providers: Providers;
}
export type AnyPlan = FillPlan | PlainFillPlan | CoheadPlan;

/** Errors the UI can show. Provider codes come from ProviderError; the rest are Fanpoint's own. */
export type RunErrorCode = ErrorCode | "invalid_request" | "agent" | "incomplete" | "internal";

export type AgentEvent =
  | { type: "step"; id: string; label: string; status: "running" | "done" | "error"; detail?: string }
  | { type: "tool"; name: string; args: unknown; summary: string; qlooCalls: QlooCallLog[] }
  | { type: "thought"; text: string }
  | { type: "result"; plan: AnyPlan }
  | { type: "error"; code: RunErrorCode; message: string; provider?: "qloo" | "llm"; retryable: boolean };
