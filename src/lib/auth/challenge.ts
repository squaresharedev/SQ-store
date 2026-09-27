import type { createClient } from "@/lib/supabase/server";
import { readLocaleCookieValue, writeLocaleCookie } from "@/i18n/cookie";
import { localeForSignedInBrowser } from "@/i18n/sign-in";
import { safeInternalPath } from "@/lib/utils/safe-path";

// SERVER ONLY, and not a "use server" module: what every way through the
// sign-in challenge does on the way out (a code, a passkey, an approval from
// another device), kept in one place so they cannot drift apart.

/**
 * Where to go after the challenge. Never back to a sign-in page (a loop), and
 * never off-site (safeInternalPath resolves the value the way a browser would).
 * Takes whatever arrived: a form field, or a search param (possibly repeated).
 */
export function afterChallenge(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const next = safeInternalPath(typeof value === "string" ? value : null);
  return next.startsWith("/login") ? "/" : next;
}

/**
 * Copy the account's saved language onto a browser that has none, once the
 * challenge completes a sign-in. Best-effort: never fails the sign-in. (The
 * first-factor step skipped it: that aal1 session could not read the profile.)
 */
export async function syncAccountLocale(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<void> {
  try {
    const accountLocale = await localeForSignedInBrowser(
      supabase,
      userId,
      await readLocaleCookieValue(),
    );
    if (accountLocale) await writeLocaleCookie(accountLocale);
  } catch (err) {
    console.warn(
      "[locale] challenge sync failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}
