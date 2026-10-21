/** Tiny private in-memory TTL cache (server only). Qloo FAQ: private server-side caching is fine; never commit responses to a public repo. */
const store = new Map<string, { v: unknown; exp: number }>();
const MAX = 500;
export function cacheGet<T>(k: string): T | undefined {
  const hit = store.get(k);
  if (!hit) return undefined;
  if (Date.now() > hit.exp) { store.delete(k); return undefined; }
  return hit.v as T;
}
export function cacheSet(k: string, v: unknown, ttlMs = 6 * 60 * 60 * 1000) {
  if (store.size >= MAX) store.delete(store.keys().next().value as string);
  store.set(k, { v, exp: Date.now() + ttlMs });
}
/** Test helper. */
export function cacheClear() { store.clear(); }
