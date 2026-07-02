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
 *
 * NOTE: Configured with fetch polyfill options to work around Node.js v24
 * undici fetch issues. If you encounter "fetch failed" errors, downgrade to
 * Node.js v22 LTS for full compatibility.
 */
export async function createClient() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) {
      console.warn(
        `Supabase credentials missing. URL: ${!!url}, Key: ${!!key}`
      );
      throw new Error("Supabase configuration incomplete");
    }

    const cookieStore = await cookies();

    return createServerClient<Database>(url, key, {
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
    });
  } catch (error) {
    console.error("Error creating Supabase client:", error);
    throw error;
  }
}
