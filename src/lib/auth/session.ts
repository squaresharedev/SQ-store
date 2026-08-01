import { cache } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import { isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types";

/**
 * Server-side session helpers. Read the session from Server Components, Route
 * Handlers, and Server Actions — never from middleware (cookies() is Node-only
 * and breaks in middleware on Workers).
 *
 * `getUser()` calls Supabase Auth to VALIDATE the token (not just decode it),
 * and refreshes it in-memory when expired. Cookie persistence of a refreshed
 * token only happens where cookie writes are allowed (Route Handlers / Server
 * Actions) — which the dashboard hits on every mutation — so sessions stay
 * valid without a middleware refresh loop.
 *
 * Wrapped in React `cache` so repeated calls within one request/render dedupe
 * to a single network round-trip.
 *
 * "Supabase is unreachable" and "you are signed out" are kept strictly apart
 * here — conflating them turns a network blip into a logout. `unstable_rethrow`
 * lets Next.js's own control-flow errors (the dynamic-usage signal `cookies()`
 * throws during static generation, or a `redirect()`) pass through uncaught —
 * see https://nextjs.org/docs/app/api-reference/functions/unstable_rethrow.
 */

/**
 * Thrown when Supabase Auth could not be REACHED — as opposed to reaching it
 * and learning the caller is signed out. Protected routes must not confuse the
 * two: treating a network blip as "signed out" bounces a seller to /login and
 * looks, to them, like a random logout.
 */
/**
 * Revoke every OTHER session for the current user, keeping this one alive.
 *
 * Call after any credential change. Supabase does not drop existing sessions
 * when a password is updated, so without this a reset performed BECAUSE an
 * account was compromised would leave the intruder signed in. `others` scope
 * so the person doing the change is not logged out of the tab they are in.
 *
 * Best-effort by design: the credential has already changed by the time this
 * runs, so a failure here must not turn a successful change into an error the
 * user might retry. It is logged instead.
 */
export async function revokeOtherSessions(client: {
  auth: { signOut: (options: { scope: "others" }) => Promise<{ error: unknown }> };
}): Promise<void> {
  try {
    const { error } = await client.auth.signOut({ scope: "others" });
    if (error) console.warn("[auth] could not revoke other sessions:", error);
  } catch (err) {
    console.warn(
      "[auth] revoking other sessions threw:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

export class AuthUnreachableError extends Error {
  constructor(cause: unknown) {
    super("Could not reach Supabase Auth.", { cause });
    this.name = "AuthUnreachableError";
  }
}

/**
 * Ceiling on how long a page render may block on Supabase Auth.
 *
 * auth-js retries a failing token refresh with exponential backoff for up to
 * AUTO_REFRESH_TICK_DURATION_MS (30 seconds) before giving up. That policy
 * suits a background refresh ticker; inside a Server Component it means an
 * unreachable Supabase hangs the response for ~27s (measured) before anything
 * renders. Auth normally answers well inside a second, so we stop waiting long
 * before auth-js does and report "unreachable" ourselves.
 */
const AUTH_TIMEOUT_MS = 5_000;

/** Resolves to `timeoutValue` if `promise` hasn't settled in time. */
async function withTimeout<T>(promise: Promise<T>, timeoutValue: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(timeoutValue), AUTH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Sentinel for the timeout branch, so it is impossible to confuse with a real answer. */
const TIMED_OUT = Symbol("auth-timeout");

/**
 * The raw session read: did we get an answer, and what was it? Cached so the
 * repeated calls within one render share a single round-trip (and a single
 * verdict — a blip must not make one call succeed and the next redirect).
 */
const loadUser = cache(
  async (): Promise<{ user: User | null; unreachable: unknown }> => {
    try {
      const supabase = await createClient();
      const result = await withTimeout<
        Awaited<ReturnType<typeof supabase.auth.getUser>> | typeof TIMED_OUT
      >(supabase.auth.getUser(), TIMED_OUT);

      if (result === TIMED_OUT) {
        return {
          user: null,
          unreachable: new Error(
            `Supabase Auth did not respond within ${AUTH_TIMEOUT_MS}ms.`,
          ),
        };
      }

      const {
        data: { user },
        error,
      } = result;
      // auth-js RETURNS its errors rather than throwing them (it catches every
      // AuthError internally), so a network failure arrives here as a value —
      // which is exactly why it used to be misread as "signed out". Only
      // AuthRetryableFetchError means "never got an answer"; every other error
      // (bad/expired/missing token) is a real answer: signed out.
      if (error) {
        return {
          user: null,
          unreachable: isAuthRetryableFetchError(error) ? error : null,
        };
      }
      return { user, unreachable: null };
    } catch (error) {
      unstable_rethrow(error);
      return { user: null, unreachable: error };
    }
  },
);

/**
 * The current user, or null when signed out. A network failure also reads as
 * null here, which is correct for OPTIONAL checks (the login page rendering
 * its form, a nav bar hiding an avatar). Routes that gate access on the answer
 * must use `requireUser`, which refuses to guess.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const { user } = await loadUser();
  return user;
});

/**
 * The current user's profile row, or null if signed out. A read failure also
 * reads as null, which is correct only for COSMETIC consumers (the nav avatar,
 * a username fallback). Pages that render FORMS from the profile must use
 * `requireProfile` instead: seeded from a silent null, a settings form shows
 * blank fields and default toggles, and saving it would overwrite the user's
 * real data with those blanks.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  return data;
});

/**
 * The profile row for a page that EDITS it. Signed-out callers are redirected
 * by the surrounding layout's requireUser gate before this runs; here a
 * missing row means the read failed (signup provisions the row), so throw to
 * the error boundary rather than seed a form with blanks.
 */
export const requireProfile = cache(async (): Promise<Profile> => {
  const user = await getUser();
  if (!user) {
    // No session: the layout's requireUser will have redirected already; this
    // guards direct misuse from an unguarded call site.
    redirect("/login");
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (error || !data) {
    throw new Error(
      `Your profile is unavailable right now: ${error?.message ?? "row missing"}`,
    );
  }
  return data;
});

/**
 * Require an authenticated user or redirect to /login. Pass the current path so
 * the user is returned there after signing in.
 */
export async function requireUser(nextPath?: string): Promise<User> {
  const { user, unreachable } = await loadUser();
  // Supabase never answered: we do NOT know whether this seller is signed in,
  // so we must not act as if they aren't. Redirecting here would discard a
  // perfectly good session and read as a spontaneous logout; throwing hands
  // the render to the nearest error boundary, which offers a retry and keeps
  // the session cookie intact.
  if (unreachable) throw new AuthUnreachableError(unreachable);
  if (!user) {
    const query = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    redirect(`/login${query}`);
  }
  return user;
}
