import { createAdminClient } from "@/lib/supabase/admin";

// SERVER ONLY. Both helpers go through the service-role admin client, because
// email_by_username and username_taken are granted to service_role ALONE. That
// is the point: neither question ("who owns this handle?", "is it free?") is
// answerable through PostgREST by an anonymous or signed-in caller, so this
// module is the only door and every caller through it is rate limited.

/**
 * Resolve a sign-in handle to the account's email address.
 *
 * Returns null when nobody holds the handle AND when the lookup itself fails.
 * Collapsing those two is deliberate: the caller must treat both as "no sign-in
 * for you" and say exactly what it says for a wrong password, so an outage can
 * never become a signal either.
 */
export async function emailForUsername(username: string): Promise<string | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("email_by_username", {
      p_username: username,
    });
    if (error) {
      console.warn("[auth] username resolve failed:", error.message);
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.warn(
      "[auth] username resolve threw:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Is this handle already someone else's? `exceptUserId` is the caller's own id,
 * so a user re-saving the handle they already hold sees "available" rather than
 * "taken".
 *
 * Returns null when the check could not be made. Callers must NOT read that as
 * "free": at sign-up and at save this is only a nicety on top of
 * profiles_username_lower_idx, which is what actually decides the race.
 */
export async function isUsernameTaken(
  username: string,
  exceptUserId?: string,
): Promise<boolean | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("username_taken", {
      p_username: username,
      ...(exceptUserId ? { p_except: exceptUserId } : {}),
    });
    if (error) {
      console.warn("[auth] username availability check failed:", error.message);
      return null;
    }
    return data === true;
  } catch (err) {
    console.warn(
      "[auth] username availability check threw:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
