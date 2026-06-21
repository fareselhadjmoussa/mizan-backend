// Tiny in-memory TTL cache for expensive, frequently-polled read endpoints
// (dashboard, finance summary). Not a replacement for Redis in a multi-instance
// deployment, but enough to collapse N concurrent requests into 1 DB hit
// for a single-process Node server — which is what this project runs as.
//
// Any mutation that should invalidate a cached key (e.g. creating a sale)
// calls `invalidate(key)` so the next read recomputes fresh data instead of
// waiting out the full TTL.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

export async function cached<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value as T;
  }
  const value = await compute();
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export function invalidate(key: string): void {
  store.delete(key);
}

export function invalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
