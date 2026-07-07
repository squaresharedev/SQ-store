import { createAdminClient } from "@/lib/supabase/admin";
import { createNotificationSchema } from "@/lib/validation/notifications";
import type { CreateNotificationInput } from "@/lib/validation/notifications";
import type { Json } from "@/types";

/**
 * The ONE place a notification is created. Server-side only (service_role),
 * Zod-validated, never callable from the client — the table has no client
 * insert policy or grant, so this is the sole write path.
 *
 * Every producer (team invites today; payments/stock/orders later) calls this
 * helper instead of inserting directly, so the shape, validation, and audit
 * point stay centralized.
 *
 * Best-effort by contract: returns false on failure and never throws, so a
 * notification problem can never break the business action that triggered it.
 * Callers should not await-and-branch on the result for correctness.
 */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<boolean> {
  const parsed = createNotificationSchema.safeParse(input);
  if (!parsed.success) {
    console.error(
      "[notifications] rejected invalid createNotification input:",
      parsed.error.issues[0]?.message,
    );
    return false;
  }

  const { userId, type, title, body, data } = parsed.data;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      type,
      title,
      body,
      data: data as Json,
    });
    if (error) {
      console.error("[notifications] insert failed:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      "[notifications] createNotification threw:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Resolve an email to an existing user's id, or null if nobody has signed up
 * with it yet. Used by producers that address a notification by email (e.g. a
 * team invite) before the recipient has linked their account.
 *
 * Server-side only. Goes through the `user_id_by_email` SECURITY DEFINER
 * function, which is granted to service_role ONLY (not anon/authenticated), so
 * this email → id lookup is never exposed to clients as an enumeration oracle.
 */
export async function resolveUserIdByEmail(
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("user_id_by_email", {
      p_email: normalized,
    });
    if (error) {
      console.error("[notifications] user_id_by_email failed:", error.message);
      return null;
    }
    return data ?? null;
  } catch (err) {
    console.error(
      "[notifications] resolveUserIdByEmail threw:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
