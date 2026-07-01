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
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
    },
  );
}
