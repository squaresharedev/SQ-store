import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { getActorRole } from "@/lib/team/queries";
import type { TeamRole } from "@/lib/team/permissions";

/**
 * ACTIVE ACCOUNT — which store the dashboard is currently operating on.
 *
 * The dashboard is multi-tenant: you always act on ONE account_owner_id, either
 * your own store (default) or a store you're an active team member of. The
 * selection lives in a cookie, but it is NEVER trusted — `getActiveAccount`
 * re-validates membership server-side on every request (via the DB-authoritative
 * team_actor_role) and falls back to your own account if the cookie is stale or
 * tampered. RLS is the real boundary; this just picks which account's rows the
 * queries explicitly filter to.
 *
 * Server-only (reads cookies + session). Do not import from Client Components.
 */

export const ACTIVE_ACCOUNT_COOKIE = "ss_active_account";

export type ActiveAccount = {
  /** The account_owner_id whose store is being viewed/managed. */
  accountId: string;
  /** The caller's role on that account (owner for your own store). */
  role: TeamRole;
  /** True when viewing your own store. */
  isOwner: boolean;
  /** The signed-in user's id. */
  userId: string;
};

export type AccountOption = {
  accountId: string;
  role: TeamRole;
  storeName: string;
  isSelf: boolean;
};

/**
 * Resolve the active account for this request. Deduped per render via React
 * cache. Returns null only when signed out.
 */
export const getActiveAccount = cache(async (): Promise<ActiveAccount | null> => {
  const user = await getUser();
  if (!user) return null;

  const store = await cookies();
  const requested = store.get(ACTIVE_ACCOUNT_COOKIE)?.value;

  // Default (and fast path): your own store. You always own it.
  if (!requested || requested === user.id) {
    return { accountId: user.id, role: "owner", isOwner: true, userId: user.id };
  }

  // Switched to another account: it is only valid if you're an active member.
  const role = await getActorRole(requested);
  if (!role) {
    // Stale / tampered cookie — silently fall back to your own store.
    return { accountId: user.id, role: "owner", isOwner: true, userId: user.id };
  }
  return {
    accountId: requested,
    role,
    isOwner: requested === user.id,
    userId: user.id,
  };
});

/**
 * Accounts the caller can switch to: their own store + every store they're an
 * active member of. Self-gated at the DB (team_my_accounts). Empty on error.
 */
export async function getAccessibleAccounts(): Promise<AccountOption[]> {
  const user = await getUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_my_accounts");
  if (error) {
    console.warn("[account] team_my_accounts error", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    accountId: row.account_owner_id,
    role: row.role as TeamRole,
    storeName: row.store_name,
    isSelf: row.is_self,
  }));
}
