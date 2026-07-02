import { createBrowserClient } from "@supabase/ssr";
import { AUTH_COOKIE_OPTIONS } from "./cookie-options";
import type { Database } from "@/types";

/**
 * Supabase client for Client Components (runs in the browser).
 *
 * Because the auth cookie is HttpOnly (see ./cookie-options.ts), this client
 * cannot restore the session from cookies on its own — the session is
 * established and refreshed server-side. Use this client for client-side
 * data/realtime calls that happen *after* the server has signed the user in.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      `Supabase credentials missing. URL: ${!!url}, Key: ${!!key}. ` +
      `Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local`
    );
  }

  return createBrowserClient<Database>(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
  });
}
