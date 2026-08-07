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
 *
 * NOTHING IS PERSISTED IN THE BROWSER. The three flags below are the guarantee,
 * not an optimisation:
 *
 *  - `persistSession: false` — auth-js never writes a session anywhere it can
 *    reach. Its default home is localStorage, which is readable by any script
 *    on the origin, so a single XSS becomes a stolen refresh token with a long
 *    life. Off, there is nothing to steal. Note that `cookieOptions.httpOnly`
 *    below cannot achieve this on its own: JavaScript is not permitted to set
 *    an HttpOnly cookie, so a browser-side write would silently downgrade to a
 *    script-readable one.
 *  - `autoRefreshToken: false` — refreshing needs a stored refresh token, which
 *    is exactly what we decline to hold. The server refreshes.
 *  - `detectSessionInUrl: false` — this app exchanges OAuth and recovery codes
 *    server-side in /auth/callback. Leaving it on would let the browser client
 *    pick a code out of the URL and start its own session.
 *
 * The one thing that needs a token here is the realtime subscription, and it
 * asks the server for a short-lived one per connection via `getRealtimeToken()`
 * and hands it over with `realtime.setAuth()` — held in memory, never stored.
 * See lib/notifications/useNotifications.ts.
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
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
