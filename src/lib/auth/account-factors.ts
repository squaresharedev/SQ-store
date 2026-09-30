import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  APPROVAL_FACTOR_PREFIX,
  PASSKEY_FACTOR_PREFIX,
} from "@/lib/auth/assurance";

/**
 * EVERY verified second factor on the account, and what the app knows it to
 * be. Where lib/auth/assurance.ts reads kinds from factor NAMES (cheap, on
 * every request, and only used to choose controls), this checks the app's own
 * records, for the places that show or remove factors:
 *
 *   app       an authenticator app (a TOTP factor with an ordinary name)
 *   passkey   named "passkey:" AND backed by a row in mfa_passkeys
 *   approval  named "approval:" AND the account's row in mfa_approval_factors
 *   unknown   anything else: a reserved name with no record behind it, or a
 *             factor type the app never creates
 *
 * WHY. GoTrue lets a fully signed-in session enrol factors of its own, around
 * the app. Such a factor can no longer be switched on (the verify-intent hook
 * refuses it), but one named "approval:..." would otherwise be hidden from
 * Settings entirely. Nothing on an account may be invisible to its owner.
 *
 * SERVER ONLY (service role). Null when the records cannot be read.
 */

export type FactorKind = "app" | "passkey" | "approval" | "unknown";

export type AccountFactor = {
  id: string;
  /** As the person named it, prefix removed; the raw name for an unknown one. */
  name: string;
  kind: FactorKind;
  createdAt: string;
};

export async function accountFactors(
  user: Pick<User, "id" | "factors">,
): Promise<AccountFactor[] | null> {
  const verified = (user.factors ?? [])
    .filter((factor) => factor.status === "verified")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (verified.length === 0) return [];

  let passkeyIds: Set<string>;
  let approvalId: string | null;
  try {
    const admin = createAdminClient();
    const [passkeys, approval] = await Promise.all([
      admin.from("mfa_passkeys").select("factor_id").eq("user_id", user.id),
      admin.from("mfa_approval_factors").select("factor_id").eq("user_id", user.id).maybeSingle(),
    ]);
    if (passkeys.error || approval.error) {
      console.error("[mfa] reading factor records failed:", (passkeys.error ?? approval.error)?.message);
      return null;
    }
    passkeyIds = new Set((passkeys.data ?? []).map((row) => row.factor_id as string));
    approvalId = (approval.data?.factor_id as string | undefined) ?? null;
  } catch (err) {
    console.error("[mfa] reading factor records threw:", err instanceof Error ? err.message : String(err));
    return null;
  }

  return verified.map((factor, index) => {
    const raw = factor.friendly_name?.trim() ?? "";
    const lower = raw.toLowerCase();
    let kind: FactorKind;
    let name = raw;
    if (factor.factor_type !== "totp") {
      kind = "unknown";
    } else if (lower.startsWith(PASSKEY_FACTOR_PREFIX)) {
      kind = passkeyIds.has(factor.id) ? "passkey" : "unknown";
      if (kind === "passkey") name = raw.slice(PASSKEY_FACTOR_PREFIX.length).trim();
    } else if (lower.startsWith(APPROVAL_FACTOR_PREFIX)) {
      kind = factor.id === approvalId ? "approval" : "unknown";
    } else {
      kind = "app";
    }
    return {
      id: factor.id,
      name: name || `${kind === "passkey" ? "Passkey" : "Authenticator app"} ${index + 1}`,
      kind,
      createdAt: factor.created_at,
    };
  });
}

/** The factors that are real ways in (apps and passkeys). */
export function realFactors(factors: AccountFactor[]): AccountFactor[] {
  return factors.filter((factor) => factor.kind === "app" || factor.kind === "passkey");
}
