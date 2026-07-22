/**
 * Network-resilient `fetch` for the SERVER-side Supabase clients.
 *
 * Symptom this exists for: an intermittent `AuthRetryableFetchError: fetch
 * failed` on server renders (most visibly the dashboard overview and /login,
 * whose first act is a token refresh). The failure is transport-level, not
 * Supabase — `fetch` rejects with a bare `TypeError: fetch failed` whose cause
 * is the real reason (ECONNRESET on a dead keep-alive socket, ENOTFOUND while
 * DNS is briefly down, a timeout as the machine wakes from sleep). undici will
 * not replay any of it, because the auth calls are POSTs (non-idempotent).
 *
 * ONE immediate replay, deliberately. This is scoped to exactly the dead-socket
 * case: that failure returns in ~0ms and the replay lands on a fresh
 * connection, so it costs nothing and fixes the blip.
 *
 * Do NOT add backoff here. This wrapper runs INSIDE auth-js's own refresh
 * retry loop, which already retries with exponential backoff for up to
 * AUTO_REFRESH_TICK_DURATION_MS (30s) — so any delay added here is multiplied
 * by that loop. Riding out an outage is not this function's job: bounding it
 * is done once, at the call site, by withTimeout() in lib/auth/session.ts.
 *
 * Only transport failures are replayed. Any HTTP response, including 4xx/5xx,
 * is returned untouched so Supabase's own error handling stays in charge.
 */

/** Attempts, not retries: 1 original + 1 immediate replay. Do not raise. */
const MAX_ATTEMPTS = 2;

/**
 * A network-layer failure (DNS, connection reset, closed keep-alive socket).
 * `fetch` signals these as a TypeError — verified against Next.js's patched
 * server `fetch`, which preserves the type and nests the real cause. An HTTP
 * error is a resolved Response and never lands here.
 */
function isTransportError(error: unknown): boolean {
  return error instanceof TypeError;
}

export const resilientFetch: typeof fetch = async (input, init) => {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      // An aborted request is the caller's intent, not a blip — never replay it.
      if (init?.signal?.aborted || !isTransportError(error)) throw error;
      lastError = error;
    }
  }

  throw lastError;
};
