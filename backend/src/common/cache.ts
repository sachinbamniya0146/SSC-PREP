// Tiny in-memory TTL cache for read-heavy, rarely-changing data
// (bank meta, subjects, leaderboard). No external deps; per-process.
interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();

export function cacheGet<T>(key: string): T | null {
  const e = store.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    store.delete(key);
    return null;
  }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
  // opportunistic cleanup — keep map bounded
  if (store.size > 500) {
    const now = Date.now();
    for (const [k, v] of store) {
      if (now > v.expiresAt) store.delete(k);
    }
  }
}

// BUGFIX (Sep 2026 — "syllabus Excel import ke baad admin panel pe purane
// chapter/topic counts dikhte hain"): subjects()/chapters() cache their
// results for 5 minutes for read performance, but nothing ever invalidated
// that cache when the underlying data actually changed — a bulk syllabus
// import (or any admin action that adds/removes subjects, chapters, or
// questions) would silently sit behind a stale cache for up to 5 minutes
// no matter how many times the admin reloaded the page. Call this right
// after any such write so the very next read is fresh.
export function cacheClearPrefix(prefix: string): void {
  for (const k of store.keys()) {
    if (k.startsWith(prefix)) store.delete(k);
  }
}

export function cacheClearAll(): void {
  store.clear();
}
