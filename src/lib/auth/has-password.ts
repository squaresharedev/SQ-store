import { createAdminClient } from "@/lib/supabase/admin";

/**
 * SERVER ONLY. Does this account actually have a password?
 *
 * Asks the DATABASE, not `user.identities`. That list was the wrong source and
 * the bug was not cosmetic: setting a password on an OAuth account through the
 * recovery flow writes `auth.users.encrypted_password` but does NOT create an
 * `email` identity row, so a real password read as "none". Two things fell out
 * of that, and the second is the serious one:
 *
 *   - the settings password card was hidden from accounts that had a password;
 *   - `requestEmailChange` skips re-authentication when this is false, so a
 *     hijacked session could move the account's address without proving
 *     anything, then request a reset to the new inbox. Full takeover, no
 *     credential needed.
 *
 * FAILS CLOSED. An unreachable lookup answers true, so callers demand a
 * password rather than waving the check through. Being wrong that way confuses
 * one OAuth user; being wrong the other way costs an account.
 *
 * Goes through `user_has_password`, which is SECURITY DEFINER (it reads
 * auth.users) and granted to service_role ONLY, so this is never an oracle a
 * client can point at somebody else's id.
 */
export async function accountHasPassword(userId: string): Promise<boolean> {
  if (!userId) return true; // fail closed
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("user_has_password", {
      p_user_id: userId,
    });
    if (error) {
      console.warn("[auth] user_has_password failed:", error.message);
      return true; // fail closed
    }
    return data !== false;
  } catch (err) {
    console.warn(
      "[auth] user_has_password threw:",
      err instanceof Error ? err.message : String(err),
    );
    return true; // fail closed
  }
}
