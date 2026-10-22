import { createAdminClient } from "@/lib/supabase/admin";
import { sha256Hex } from "@/lib/utils/sha256";

/**
 * THE APP'S PERMISSION TO CREATE AN EMAIL ACCOUNT.
 *
 * Supabase's own sign-up endpoint answers anyone holding the public anon key,
 * so the guards in authenticate() (disposable addresses, the bot check, the
 * per-client budget, breached passwords) would be advisory on their own. The
 * Before User Created hook (public.signup_intent_gate, migration
 * 20261021_signup_intents.sql) refuses an email sign-up unless the app has just
 * written a single-use intent for that address. authenticate() writes it AFTER
 * every guard has passed and immediately before signUp, so an account can only
 * be created by a request that got through them.
 *
 * Until the hook is enabled the intent is written and simply expires unused.
 *
 * SERVER ONLY (service role). Not a "use server" module.
 */

/** Long enough for the signUp round trip that follows, far too short to reuse. */
export const SIGNUP_INTENT_SECONDS = 300;

/** The key the hook recomputes in SQL: sha256 of the trimmed, lower-cased address. */
export function signupIntentHash(email: string): Promise<string> {
  return sha256Hex(email.trim().toLowerCase());
}

/**
 * Record that `email` passed the sign-up guards. Never throws: a failed write
 * only means the hook (when enabled) refuses this one sign-up, which is the
 * safe outcome, so the caller goes on to signUp either way and lets GoTrue
 * answer.
 */
export async function recordSignupIntent(email: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const emailHash = await signupIntentHash(email);
    // Expired intents are useless; clear them as they accumulate.
    await admin.from("signup_intents").delete().lt("expires_at", new Date().toISOString());
    const { error } = await admin.from("signup_intents").insert({
      email_hash: emailHash,
      expires_at: new Date(Date.now() + SIGNUP_INTENT_SECONDS * 1000).toISOString(),
    });
    if (error) console.error("[auth] writing the signup intent failed:", error.message);
  } catch (err) {
    console.error(
      "[auth] writing the signup intent threw:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
