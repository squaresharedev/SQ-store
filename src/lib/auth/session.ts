import { cache } from "react";
import { redirect } from "next/navigation";
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
 * NOTE: Handles Node.js v24 fetch errors gracefully by returning null.
 */

export const getUser = cache(async (): Promise<User | null> => {
  try {
    let supabase;
    try {
      supabase = await createClient();
    } catch (clientError) {
      console.warn("Failed to create Supabase client:", clientError);
      return null;
    }

    try {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();
      if (error) {
        console.warn("Auth error:", error);
        return null;
      }
      return user;
    } catch (authError) {
      console.warn("Failed to get user:", authError);
      return null;
    }
  } catch (error) {
    // Handle any unexpected errors gracefully
    console.warn("Unexpected error in getUser:", error);
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
