import {
  createClient as createSupabaseClient,
  isAuthRetryableFetchError,
} from "@supabase/supabase-js";
import { resilientFetch } from "@/lib/supabase/fetch";

// SERVER ONLY. Not a "use server" module: nothing here may be callable from the
// browser, since it answers "is this the right password for that address?".

export type PasswordCheck = "correct" | "incorrect" | "unavailable";

/**
 * Is `password` the current password for `email`? Answered WITHOUT touching
 * the caller's own session.
 *
 * WHY NOT signInWithPassword ON THE REQUEST CLIENT. That is what the settings
 * actions used to do, and it REPLACES the session in the cookies with a brand
 * new one. For an account with 2FA that new session is `aal1`, so re-typing a
 * password to change an email silently downgraded the person to "still owes a
 * second factor" and bounced them to the challenge mid-task. Worse, it was the
 * one place a password alone manufactured a fresh session inside a session
 * that had proven more.
 *
 * So the check runs on a throwaway client with no storage at all: it signs in,
 * learns the answer, and immediately revokes the session it just created
 * (scope "local" = that session only), leaving nothing behind.
 *
 * Every caller MUST sit behind a rate limit: this is a password oracle.
 */
export async function checkPassword(email: string, password: string): Promise<PasswordCheck> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !email || !password) return "unavailable";

  const probe = createSupabaseClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: resilientFetch },
  });

  try {
    const { data, error } = await probe.auth.signInWithPassword({ email, password });
    if (error) {
      // A network failure is not a wrong password, and must not be reported
      // as one: the person would start doubting a password that is fine.
      // GoTrue's own throttle (429) is not an answer about the password either.
      if (isAuthRetryableFetchError(error) || error.status === 429) {
        return "unavailable";
      }
      return "incorrect";
    }
    if (data.session) {
      await probe.auth.signOut({ scope: "local" }).catch(() => {});
    }
    return "correct";
  } catch (err) {
    console.warn(
      "[auth] password check failed:",
      err instanceof Error ? err.message : String(err),
    );
    return "unavailable";
  }
}
