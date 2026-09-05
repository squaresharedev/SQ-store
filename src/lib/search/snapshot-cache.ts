import type { SearchSnapshot, SearchSnapshotResponse } from "@/lib/search/types";

/**
 * CLIENT-SIDE cache for the search snapshot (/api/search/snapshot).
 *
 * MODULE scope, not component state, deliberately: the search provider lives
 * inside DashboardShell, which is a *different layout instance* per route
 * group — navigating dashboard → settings unmounts and remounts it, and
 * component state would refetch on every hop. Module scope survives those
 * remounts for the life of the tab.
 *
 * MEMORY only, never web storage. This would be the repo's first
 * localStorage/sessionStorage use, the data is another person's store on a
 * shared machine the moment an account switch happens, and the whole session
 * model here is deliberately HttpOnly. A tab refresh refetching one small
 * payload is the right price.
 *
 * Keyed by ACCOUNT id — which arrives as a server-rendered prop, so a key can
 * only ever name an account the server already let this user act as. Stale
 * entries for other accounts are kept (bounded) so switching back is instant.
 *
 * SWR semantics: fresh hits return synchronously; stale hits return the old
 * data NOW and refresh behind; misses fetch. Concurrent callers share one
 * in-flight request. Errors resolve null and cache nothing — the palette
 * degrades to registry + live search, never throws.
 */

// 5 minutes: long enough that a single tab refreshing every few minutes does
// not exhaust the 600/hour rate limit ceiling, short enough that a catalogue
// change shows up quickly in search. The previous 60 s TTL meant 60 refreshes
// per hour per tab, which hit the old 120/hour ceiling during normal use.
const SNAPSHOT_TTL_MS = 300_000;
const MAX_CACHED_ACCOUNTS = 3;

type CacheEntry = { snapshot: SearchSnapshot; fetchedAt: number };

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<SearchSnapshot | null>>();

/** Read whatever is cached, however old. Synchronous, for use during render. */
export function getCachedSnapshot(accountId: string): SearchSnapshot | null {
  return cache.get(accountId)?.snapshot ?? null;
}

/**
 * Get the snapshot for an account, fetching if needed.
 *
 * Fresh cache → resolves immediately with it, no request.
 * Stale cache → resolves immediately with it AND refreshes in the background.
 * Miss        → fetches (deduped against concurrent callers).
 */
export function fetchSnapshot(accountId: string): Promise<SearchSnapshot | null> {
  const entry = cache.get(accountId);
  const now = Date.now();

  if (entry) {
    if (now - entry.fetchedAt >= SNAPSHOT_TTL_MS && !inFlight.has(accountId)) {
      // Stale: hand back the old data without waiting, refresh behind.
      void requestSnapshot(accountId);
    }
    return Promise.resolve(entry.snapshot);
  }

  return inFlight.get(accountId) ?? requestSnapshot(accountId);
}

function requestSnapshot(accountId: string): Promise<SearchSnapshot | null> {
  const promise = (async (): Promise<SearchSnapshot | null> => {
    try {
      const response = await fetch("/api/search/snapshot", {
        headers: { accept: "application/json" },
      });
      if (!response.ok) return null;
      const body = (await response.json()) as SearchSnapshotResponse;
      if (!body?.snapshot) return null;
      cache.set(accountId, { snapshot: body.snapshot, fetchedAt: Date.now() });
      evictBeyond(MAX_CACHED_ACCOUNTS);
      return body.snapshot;
    } catch {
      // Offline / aborted / malformed: a miss stays a miss. The caller's UI
      // has the registry and the live search; nothing here is load-bearing.
      return null;
    } finally {
      inFlight.delete(accountId);
    }
  })();
  inFlight.set(accountId, promise);
  return promise;
}

/** Drop the oldest entries past the cap. A user realistically flips between
 *  two or three stores; anything more is a leak, not a working set. */
function evictBeyond(max: number) {
  if (cache.size <= max) return;
  const oldestFirst = [...cache.entries()].sort(
    (a, b) => a[1].fetchedAt - b[1].fetchedAt,
  );
  for (const [key] of oldestFirst.slice(0, cache.size - max)) {
    cache.delete(key);
  }
}

/** Test-only: reset module state between cases. */
export function __clearSnapshotCache() {
  cache.clear();
  inFlight.clear();
}
