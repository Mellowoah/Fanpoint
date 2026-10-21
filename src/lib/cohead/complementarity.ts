/**
 * Co-headliner complementarity, computed from two acts' Qloo fan heat per touring city (0..1).
 *
 *   strong = heat >= strongThreshold, weak = heat < weakThreshold (RULES; 0.95 / 0.91 since the 2026-10-21 live calibration:
 *   the 75th and 60th percentiles of live city reads, i.e. an act's top quarter and bottom 60% of markets).
 *   youGain   = cities where you are weak and they are strong (they carry the room for you)
 *   theyGain  = cities where they are weak and you are strong
 *   overlap   = cities where both are strong (same fans, same rooms: a co-bill adds little there)
 *   score     = youGain + theyGain - 0.5 * |youGain - theyGain| - 0.25 * overlap   (weights: RULES.cohead*Penalty)
 * The asymmetry penalty favours two-way deals (agents on both sides must say yes); the overlap penalty is what
 * makes "most similar" acts rank low. Cities missing from either act's read are skipped for gain/overlap, never guessed.
 */
import { RULE_VALUES } from "../touring/rules";

export const THRESHOLDS = { strong: RULE_VALUES.strongThreshold, weak: RULE_VALUES.weakThreshold } as const;
const ASYM = RULE_VALUES.coheadAsymmetryPenalty, OVERLAP = RULE_VALUES.coheadOverlapPenalty;
export interface Thresholds { strong: number; weak: number }

export interface Complementarity {
  score: number;
  /** City names, strongest partner heat first. */
  youGain: string[];
  theyGain: string[];
  overlap: string[];
  /** Cities where at least one act is strong (union, over every city either act was read in). */
  coveredStrong: number;
  youStrong: number;
  themStrong: number;
  /** Strong cities the co-bill adds on top of each act's own strong cities. */
  newStrongForYou: number;
  newStrongForThem: number;
}

export function complementarity(you: ReadonlyMap<string, number>, them: ReadonlyMap<string, number>, t: Thresholds = THRESHOLDS): Complementarity {
  if (!(t.weak <= t.strong)) throw new RangeError("weak threshold must be <= strong threshold");
  const youGain: string[] = [], theyGain: string[] = [], overlap: string[] = [];
  for (const [city, a] of you) {
    const b = them.get(city);
    if (b === undefined) continue;
    if (a < t.weak && b >= t.strong) youGain.push(city);
    if (b < t.weak && a >= t.strong) theyGain.push(city);
    if (a >= t.strong && b >= t.strong) overlap.push(city);
  }
  const strongIn = (m: ReadonlyMap<string, number>) => new Set([...m].filter(([, v]) => v >= t.strong).map(([k]) => k));
  const ys = strongIn(you), ts = strongIn(them);
  const union = new Set([...ys, ...ts]).size;
  const by = (m: ReadonlyMap<string, number>) => (x: string, y: string) => (m.get(y) ?? 0) - (m.get(x) ?? 0) || x.localeCompare(y);
  youGain.sort(by(them)); theyGain.sort(by(you)); overlap.sort(by(you));
  const raw = youGain.length + theyGain.length - ASYM * Math.abs(youGain.length - theyGain.length) - OVERLAP * overlap.length;
  return {
    score: Math.round(raw * 100) / 100, youGain, theyGain, overlap,
    coveredStrong: union, youStrong: ys.size, themStrong: ts.size, newStrongForYou: union - ys.size, newStrongForThem: union - ts.size,
  };
}
