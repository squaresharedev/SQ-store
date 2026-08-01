import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AUTH_COOKIE_OPTIONS } from "./cookie-options";
import { resilientFetch } from "./fetch";
import type { Database } from "@/types";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 * Reads and writes the session from the Next.js cookie store on the Node
 * runtime.
 *
 * IMPORTANT: this uses `cookies()` from `next/headers`, which is Node-only. Do
 * NOT move this into `middleware.ts` — the cookies() API breaks in middleware on
 * Cloudflare Workers (per the project brief). Refresh sessions from a Route
 * Handler or Server Action instead.
 *
 * Do NOT wrap the `cookies()` call below in try/catch: during static
 * generation Next.js uses it to throw a control-flow signal (marking the
 * route dynamic) that must propagate uncaught. Callers that need resilience
 * against a genuinely missing session should catch around the auth *call*
 * (e.g. `supabase.auth.getUser()`), not around `createClient()` itself — see
 * `unstable_rethrow` in lib/auth/session.ts.
 */
export async function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase configuration incomplete: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    // Replays transport-level failures (dead keep-alive sockets) so a blip
    // doesn't surface as `AuthRetryableFetchError: fetch failed` mid-render.
    global: { fetch: resilientFetch },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          // Enforce our domain/HttpOnly/Secure/SameSite on every cookie while
          // keeping Supabase's own maxAge/expires. Our options are spread last
          // so they win over the library defaults.
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, {
              ...options,
              ...AUTH_COOKIE_OPTIONS,
            });
          });
        } catch {
          // EXPECTED, not an error: `setAll` was called during a Server
          // Component render, where Next disallows cookie writes. The session
          // refresh that matters happens in a Route Handler or Server Action,
          // which can write. Logging here fired on ordinary page renders and
          // read as a failure, so it is deliberately silent.
        }
      },
    },
  });
}
