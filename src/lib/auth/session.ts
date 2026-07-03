import { cache } from "react";
import { redirect, unstable_rethrow } from "next/navigation";
import type { User } from "@supabase/supabase-js";
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
 * Catches genuine network failures (e.g. Supabase unreachable) and treats
 * them as signed-out rather than crashing the render. `unstable_rethrow` lets
 * Next.js's own control-flow errors (the dynamic-usage signal `cookies()`
 * throws during static generation, or a `redirect()`) pass through uncaught —
 * see https://nextjs.org/docs/app/api-reference/functions/unstable_rethrow.
 */
export const getUser = cache(async (): Promise<User | null> => {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error) return null;
    return user;
  } catch (error) {
    unstable_rethrow(error);
    console.warn("Could not reach Supabase auth:", error);
    return null;
  }
});

/** The current user's profile row, or null if signed out. */
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
 * Require an authenticated user or redirect to /login. Pass the current path so
 * the user is returned there after signing in.
 */
export async function requireUser(nextPath?: string): Promise<User> {
  const user = await getUser();
  if (!user) {
    const query = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
    redirect(`/login${query}`);
  }
  return user;
}
