import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { AUTH_COOKIE_OPTIONS } from "./cookie-options";
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
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
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
            // `setAll` was called from a Server Component render, where writing
            // cookies is disallowed. Safe to ignore when a Route Handler or
            // Server Action is responsible for refreshing the session.
          }
        },
      },
    },
  );
}
