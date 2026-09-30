import { createAdminClient } from "@/lib/supabase/admin";
import { decodeJwtPayload } from "@/lib/auth/assurance";

/**
 * THE APP'S PERMISSION TO COMPLETE A SECOND FACTOR.
 *
 * GoTrue's own verify endpoint is only limited per IP address and never locks
 * an account, so on its own it would let anyone holding a password guess
 * codes directly, past every budget, replay guard and alert in lib/auth/mfa.ts.
 * It would also let a stolen signed-in session switch on a factor of its own.
 *
 * So the Custom Access Token hook (public.mfa_access_token_gate, migration
 * 20260930_two_factor_hardening.sql) refuses to issue any second-factor token
 * unless the app has just written a single-use intent for that exact account
 * and session. Every verify the app performs (a typed code, a passkey, an
 * approval) calls authorizeFactorVerify first, AFTER its own checks have
 * passed, and withdraws the intent if GoTrue then refuses the code. A correct
 * code sent to GoTrue by anyone else earns nothing, and the verify is rolled
 * back.
 *
 * SERVER ONLY (service role). Not a "use server" module.
 */

/** Long enough for the challenge + verify round trip, far too short to reuse. */
const INTENT_SECONDS = 60;

type TokenSource = {
  auth: { getSession: () => Promise<{ data: { session: { access_token?: string } | null } }> };
};

/**
 * Write the intent for the session `supabase` is about to verify on. The ids
 * come from that session's own access token: the hook compares them with the
 * claims GoTrue itself issues, so a forged token only produces an intent that
 * matches nothing (fail closed). Null when it could not be written, in which
 * case the caller must not verify.
 */
export async function authorizeFactorVerify(supabase: TokenSource): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const claims = decodeJwtPayload(data.session?.access_token);
    const userId = typeof claims?.sub === "string" ? claims.sub : null;
    const sessionId = typeof claims?.session_id === "string" ? claims.session_id : null;
    if (!userId || !sessionId) return null;

    const admin = createAdminClient();
    // This account's stale intents, gone (they are also useless: expired).
    await admin
      .from("mfa_verify_intents")
      .delete()
      .eq("user_id", userId)
      .lt("expires_at", new Date().toISOString());
    const { data: row, error } = await admin
      .from("mfa_verify_intents")
      .insert({
        user_id: userId,
        session_id: sessionId,
        expires_at: new Date(Date.now() + INTENT_SECONDS * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (error || !row) {
      console.error("[mfa] writing the verify intent failed:", error?.message);
      return null;
    }
    return row.id as string;
  } catch (err) {
    console.error("[mfa] writing the verify intent threw:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** GoTrue refused the code: the unspent intent must not outlive the attempt. */
export async function withdrawFactorVerify(intentId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("mfa_verify_intents").delete().eq("id", intentId);
  } catch {
    // Best-effort: it expires within a minute regardless.
  }
}
