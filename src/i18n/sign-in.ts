import type { createClient } from "@/lib/supabase/server";
import { parseLocale, type Locale } from "./locales";

type ServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Reconcile the browser's language cookie with the account's saved language,
 * once, at the moment a sign-in completes.
 *
 *   - The browser HAS a choice: it wins, because it is the most recent one (it
 *     may have been made on the login page seconds ago). It is saved to the
 *     account if the account says something else. Returns null: the cookie is
 *     already right.
 *   - The browser has NO choice: the account's saved language, if any, is
 *     returned so the caller can set the cookie on this new browser.
 *
 * Best-effort by contract. A failure here must never fail the sign-in it runs
 * inside, so every error is logged and swallowed.
 *
 * Server-only.
 */
export async function localeForSignedInBrowser(
  supabase: ServerClient,
  userId: string,
  cookieValue: string | undefined,
): Promise<Locale | null> {
  try {
    const browserLocale = parseLocale(cookieValue);

    const { data, error } = await supabase
      .from("profiles")
      .select("locale")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      console.warn("[locale] sign-in read failed", error.code);
      return null;
    }
    const accountLocale = parseLocale(data?.locale);

    if (!browserLocale) return accountLocale;

    if (browserLocale !== accountLocale) {
      const { error: writeError } = await supabase
        .from("profiles")
        .update({ locale: browserLocale })
        .eq("id", userId);
      if (writeError) {
        console.warn("[locale] sign-in write failed", writeError.code);
      }
    }
    return null;
  } catch (err) {
    console.warn(
      "[locale] sign-in sync failed",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
