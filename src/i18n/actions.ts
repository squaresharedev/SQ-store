"use server";

import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { writeLocaleCookie } from "./cookie";
import { parseLocale } from "./locales";

export type SetLocaleResult = { ok: true } | { ok: false };

/**
 * Switch the UI language.
 *
 * Always writes the cookie, which is what the next request renders from. When
 * signed in, also saves the choice on the account so it follows the seller to
 * a new browser. That profile write is best-effort: the cookie already carries
 * the choice for this browser, so a failed write costs only the cross-device
 * memory and must not turn a working switch into an error.
 *
 * The value is untrusted (any caller can invoke a server action with any
 * argument) and is narrowed to the supported list before it touches the cookie
 * or the database.
 */
export async function setLocale(value: unknown): Promise<SetLocaleResult> {
  const locale = parseLocale(value);
  if (!locale) return { ok: false };

  await writeLocaleCookie(locale);

  const user = await getUser();
  if (!user) return { ok: true };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ locale })
    .eq("id", user.id); // owner id from the session; RLS enforces it again
  if (error) {
    console.warn("[locale] could not save the account's language", error.code);
  }
  return { ok: true };
}
