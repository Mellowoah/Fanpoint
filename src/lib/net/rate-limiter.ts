/**
 * Client-side rate limiter: spaces request *starts* at least `minIntervalMs` apart (FIFO).
 * 5 req/s is the limit other hackathon teams report for the Qloo hackathon key; we default to 220 ms (~4.5/s)
 * for headroom. One limiter per process and base URL, so concurrent runs in the same server share it.
 * Note: serverless deployments run several processes, each with its own limiter (see README limitations).
 */
export interface Clock { now(): number; sleep(ms: number): Promise<void> }
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

export class RateLimiter {
  private nextSlot = 0;
  constructor(readonly minIntervalMs: number, private clock: Clock = realClock) {
    if (!(minIntervalMs >= 0)) throw new RangeError("minIntervalMs must be >= 0");
  }
  /** Resolves when the caller may start its request. Reserves the slot synchronously, so calls are FIFO. */
  async acquire(): Promise<void> {
    const now = this.clock.now();
    const start = Math.max(now, this.nextSlot);
    this.nextSlot = start + this.minIntervalMs;
    if (start > now) await this.clock.sleep(start - now);
  }
}

const shared = new Map<string, RateLimiter>();
export function sharedLimiter(key: string, minIntervalMs: number): RateLimiter {
  let l = shared.get(key);
  if (!l) { l = new RateLimiter(minIntervalMs); shared.set(key, l); }
  return l;
}
