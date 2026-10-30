/** Sponsor & ad hooks for one stop: brands and podcasts from the promo list and Qloo cross-domain taste. Client-safe, deterministic. */
import type { FillStop } from "@/lib/agent/types";
import type { Entity } from "@/lib/qloo/types";
import { XD_META } from "@/lib/qloo/crossdomain";

export const MAX_HOOKS = 4;
export interface SponsorHook { entity: Entity; angle: string; angleBy: "ai" | "routed" | "code" }

const isHookKind = (e: Entity) => e.kind === "brand" || e.kind === "podcast";

/**
 * Promo ideas first in the candidate list (their angle wins on a tie), then cross-domain brands/podcasts with the
 * fixed use text. Deduped by entity id, sorted by Qloo affinity (highest first; no affinity last, original order kept), max 4.
 */
export function sponsorHooks(s: FillStop, max = MAX_HOOKS): SponsorHook[] {
  const cands: SponsorHook[] = [
    ...s.promo.filter((p) => isHookKind(p.entity)).map((p) => ({ entity: p.entity, angle: p.angle, angleBy: p.angleBy })),
    ...(s.alsoLike ?? []).flatMap((r) => r.items.filter(isHookKind).map((e) => ({ entity: e, angle: XD_META[r.key].use, angleBy: "code" as const }))),
  ];
  const seen = new Map<string, number>();
  const out: SponsorHook[] = [];
  for (const c of cands) {
    const i = seen.get(c.entity.id);
    if (i === undefined) { seen.set(c.entity.id, out.length); out.push(c); continue; }
    // Same entity again: keep the first angle, take an affinity if the first copy had none.
    const prev = out[i]!;
    if (prev.entity.affinity === undefined && c.entity.affinity !== undefined) out[i] = { ...prev, entity: { ...prev.entity, affinity: c.entity.affinity } };
  }
  return out
    .map((h, i) => ({ h, i }))
    .sort((a, b) => (b.h.entity.affinity ?? -1) - (a.h.entity.affinity ?? -1) || a.i - b.i)
    .slice(0, max)
    .map((x) => x.h);
}
