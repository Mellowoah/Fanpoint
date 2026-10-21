/**
 * Grounding filter: the model may only reference entity ids that a Qloo tool actually returned in this run.
 * Unknown ids are dropped (and listed), so a hallucinated venue or support act can never reach the UI.
 */
export interface GroundingReport { referenced: number; grounded: number; dropped: string[] }

export function createGrounder<T>(known: ReadonlyMap<string, T>) {
  let referenced = 0, grounded = 0;
  const dropped: string[] = [];
  return {
    /** Look up one id; counts it and records it as dropped when unknown. */
    pick(id: string): T | undefined {
      referenced++;
      const e = known.get(id);
      if (e === undefined) dropped.push(id); else grounded++;
      return e;
    },
    /** Look up many ids, keeping only grounded ones (order preserved, duplicates removed). */
    pickAll(ids: readonly string[]): T[] {
      const out: T[] = [];
      for (const id of new Set(ids)) { const e = this.pick(id); if (e !== undefined) out.push(e); }
      return out;
    },
    report: (): GroundingReport => ({ referenced, grounded, dropped: [...dropped] }),
  };
}
