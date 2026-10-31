import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Every connection this person approved goes. Called from what a person does
 * after a compromise: changing a password, signing out everywhere, asking for
 * their account to be deleted. Best-effort: the credential work has already
 * happened and must not be undone by a failure here, so this logs and carries
 * on, in the same way revokeOtherSessions does.
 *
 * Its own module so the sign-in actions, which every sign-in page reaches, do
 * not pull in the rest of the OAuth server for one update.
 */
export async function revokeAllGrantsForUser(userId: string): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("agent_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("revoked_at", null);
    if (error) console.error("[agent] revoking all grants failed:", error.message);
  } catch (error) {
    console.error("[agent] revoking all grants threw:", error instanceof Error ? error.message : String(error));
  }
}
