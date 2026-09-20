// Minimal in-process TTL cache. Deliberately not Redis: this app runs as a
// single process, and the only things worth caching (SDE category lists, ESI
// affiliation lookups) are cheap to recompute if the process restarts.
const store = new Map();

export function cacheGet(key) {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return entry.value;
}

export function cacheSet(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

export async function cacheWrap(key, ttlMs, fn, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    const hit = cacheGet(key);
    if (hit !== undefined) return { data: hit, cached: true };
  }
  const data = await fn();
  cacheSet(key, data, ttlMs);
  return { data, cached: false };
}

export function cacheClear(prefix) {
  if (!prefix) return store.clear();
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}
