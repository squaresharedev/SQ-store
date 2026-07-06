import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types";

/**
 * SERVICE-ROLE Supabase client — bypasses RLS. SERVER ONLY.
 *
 * Used for privileged writes the request-scoped (anon-key) server client cannot
 * do under RLS, e.g. inserting a notification for a DIFFERENT user than the one
 * making the request (an invitee accepting → notify the store owner). The
 * notifications table deliberately has NO client insert policy, so creation
 * flows through here.
 *
 * NEVER import this from a Client Component: it reads SUPABASE_SERVICE_ROLE_KEY,
 * which must never reach the browser. The runtime guard below fails loudly if it
 * is ever bundled into client code. Do not add "use client" to any file that
 * imports this.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient() must never run in the browser.");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Service-role client unavailable: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set.",
    );
  }

  // No session persistence/refresh: this client is stateless and per-call.
  return createSupabaseClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
