"use server";

/**
 * Team & Access server actions.
 *
 * SECURITY MODEL — three layers working together:
 *   1. These actions: field whitelist, Zod parse, DB-authoritative actor-role
 *      lookup via `getActorRole()`, then `can()` / `canGrant()` checks from
 *      the single permission model in permissions.ts. Friendly errors are
 *      returned here so the UI never sees raw DB exceptions.
 *   2. RLS policies: enforce member visibility and write permissions at the
 *      Postgres level regardless of what the client sends.
 *   3. BEFORE UPDATE trigger: additionally enforces owner-row immutability, no
 *      owner-role grants, accept-requires-matching-JWT-email, no rank
 *      escalation, and binds member_user_id = auth.uid() on accept.
 *
 * Role strings are NEVER hardcoded for authorization decisions — always
 * `can()` / `canGrant()` from permissions.ts.
 */

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getUser } from "@/lib/auth/session";
import { createNotification, resolveUserIdByEmail } from "@/lib/notifications/create";
import { can, canGrant, ROLE_LABELS } from "@/lib/team/permissions";
import { getActorRole } from "@/lib/team/queries";
import { ACTIVE_ACCOUNT_COOKIE } from "@/lib/team/account-context";
import {
  teamInviteSchema,
  teamAcceptSchema,
  teamChangeRoleSchema,
  teamRevokeSchema,
} from "@/lib/validation/team";
import { z } from "zod";

export type TeamActionState = {
  error?: string;
  success?: string;
};

// ---------------------------------------------------------------------------
// Module-local helpers (mirrors the pattern in lib/settings/actions.ts)
// ---------------------------------------------------------------------------

const SIGNED_OUT: TeamActionState = {
  error: "Your session expired. Sign in again.",
};

/**
 * FIELD WHITELIST guard: reject any submitted field not explicitly expected.
 * React's own `$ACTION_*` bookkeeping keys are always skipped.
 */
function unknownFieldError(
  formData: FormData,
  allowed: readonly string[],
): TeamActionState | null {
  for (const key of formData.keys()) {
    if (key.startsWith("$ACTION")) continue;
    if (!allowed.includes(key)) {
      return { error: `Unexpected field "${key}" was rejected.` };
    }
  }
  return null;
}

function firstIssue(error: z.ZodError): TeamActionState {
  return { error: error.issues[0]?.message ?? "Check the form and try again." };
}

const SETTINGS_TEAM_PATH = "/settings/team";

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Invite a new member to the team.
 *
 * The invite record is inserted immediately; the invitee sees it under
 * "Invites for you" after signing in with the invited address. Email delivery
 * is not yet wired up — see the stub comment below.
 */
export async function inviteMember(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;

  const rejected = unknownFieldError(formData, [
    "account_owner_id",
    "invited_email",
    "role",
  ]);
  if (rejected) return rejected;

  const parsed = teamInviteSchema.safeParse({
    account_owner_id: String(formData.get("account_owner_id") ?? ""),
    invited_email: String(formData.get("invited_email") ?? ""),
    role: String(formData.get("role") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  const { account_owner_id, invited_email, role } = parsed.data;

  // DB-authoritative actor role — never trust a role claim from the client.
  const actorRole = await getActorRole(account_owner_id);
  if (!can(actorRole, "team.invite")) {
    return { error: "You don't have permission to invite members." };
  }
  if (!canGrant(actorRole, role)) {
    return { error: "You can't invite someone at a role higher than your own." };
  }

  // Block inviting yourself — you're already here.
  if (user.email && invited_email === user.email.toLowerCase()) {
    return { error: "You're already here." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("team_members").insert({
    account_owner_id,
    invited_email,
    role,
    status: "invited",
  });

  if (error) {
    // Postgres unique violation: a live or previously revoked invite already
    // exists for this email on this account.
    if (error.code === "23505") {
      return { error: "Already invited or already on the team." };
    }
    return { error: "Could not send the invite. Give it another try." };
  }

  // In-app notification: if the invitee already has an account, drop a
  // notification into their bell now so they discover the invite immediately
  // (and can deep-link to this page to accept). If they haven't signed up yet
  // there is no account to notify — the email path (stubbed below) covers that
  // case once it exists. Best-effort: the whole block is guarded so nothing here
  // — resolver, getProfile, or the insert — can throw out and break the invite
  // that was already written.
  let notifiedExistingUser = false;
  try {
    const inviteeUserId = await resolveUserIdByEmail(invited_email);
    if (inviteeUserId) {
      const inviterProfile = await getProfile();
      const storeLabel =
        inviterProfile?.display_name?.trim() || "A SquareShare store";
      await createNotification({
        userId: inviteeUserId,
        type: "team",
        title: "You have a team invite",
        body: `${storeLabel} invited you to join as ${ROLE_LABELS[role]}. Open Team & access to accept.`,
        data: { href: SETTINGS_TEAM_PATH },
      });
      notifiedExistingUser = true;
    }
  } catch (err) {
    console.error(
      "[team] invite notification failed (non-blocking):",
      err instanceof Error ? err.message : String(err),
    );
  }

  // TODO(email): send the invite email once the email system exists. The
  // invite record is live; the invitee sees it under "Invites for you" after
  // signing in with this address (and in their bell if they already have an
  // account, per the block above).
  console.info("[team] invite email stub — no email sent", {
    account: account_owner_id,
    role,
    notifiedExistingUser,
  });

  revalidatePath(SETTINGS_TEAM_PATH);
  return {
    success:
      "Invite created. They'll see it when they sign in with that email. (Email sending isn't wired up yet.)",
  };
}

/**
 * Accept a pending invite addressed to the calling user's verified email.
 *
 * We perform an identity check here (invited_email === user.email) in addition
 * to what the DB trigger enforces, so the user gets a friendly error rather
 * than a raw Postgres exception if something is off.
 */
export async function acceptInvite(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  if (!user.email) {
    return { error: "Your account has no verified email address." };
  }

  const rejected = unknownFieldError(formData, ["invite_id"]);
  if (rejected) return rejected;

  const parsed = teamAcceptSchema.safeParse({
    invite_id: String(formData.get("invite_id") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  const { invite_id } = parsed.data;
  const supabase = await createClient();

  // Fetch the invite row — RLS permits the invitee to read their own pending
  // invites, so a missing row means it doesn't exist or isn't theirs.
  const { data: invite, error: fetchError } = await supabase
    .from("team_members")
    .select("id, status, invited_email, account_owner_id")
    .eq("id", invite_id)
    .maybeSingle();

  if (fetchError || !invite) {
    return { error: "Invite not found or already used." };
  }

  // Server-side identity check before touching the row.
  if (invite.status !== "invited") {
    return { error: "This invite has already been accepted or revoked." };
  }
  if (invite.invited_email !== user.email.toLowerCase()) {
    return { error: "This invite isn't for your email address." };
  }

  // Acceptance is an atomic, server-authoritative RPC: it re-verifies the JWT
  // email matches invited_email and binds member_user_id = auth.uid() as the
  // account owner (definer), with the guard trigger re-checking the same. The
  // pre-checks above only exist to return friendly errors.
  const { data: accepted, error: rpcError } = await supabase.rpc(
    "team_accept_invite",
    { p_invite_id: invite_id },
  );

  if (rpcError || !accepted) {
    return { error: "Could not accept the invite. It may have been revoked." };
  }

  console.warn(
    `[team] invite ACCEPTED invite_id=${invite_id} user_id=${user.id}`,
  );

  // Notify the store owner that someone joined their team. Best-effort — a
  // notification failure must never fail the accept (createNotification never
  // throws and returns false on error).
  const profile = await getProfile();
  const joinerName =
    profile?.display_name?.trim() || user.email?.split("@")[0] || "A new member";
  await createNotification({
    userId: invite.account_owner_id,
    type: "team",
    title: `${joinerName} joined your team`,
    body: "They now have access to your store.",
    data: { href: SETTINGS_TEAM_PATH },
  });

  revalidatePath(SETTINGS_TEAM_PATH);
  return { success: "Welcome to the team." };
}

/**
 * Change the role of an existing active or invited team member.
 *
 * The actor must hold `team.change_role` AND be able to grant the target role
 * (no elevating members above your own rank). The DB trigger enforces the same
 * rules as a backstop.
 */
export async function changeMemberRole(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;

  const rejected = unknownFieldError(formData, [
    "account_owner_id",
    "member_id",
    "role",
  ]);
  if (rejected) return rejected;

  const parsed = teamChangeRoleSchema.safeParse({
    account_owner_id: String(formData.get("account_owner_id") ?? ""),
    member_id: String(formData.get("member_id") ?? ""),
    role: String(formData.get("role") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  const { account_owner_id, member_id, role } = parsed.data;

  const actorRole = await getActorRole(account_owner_id);
  if (!can(actorRole, "team.change_role")) {
    return { error: "You don't have permission to change roles." };
  }
  if (!canGrant(actorRole, role)) {
    return { error: "You can't assign a role higher than your own." };
  }

  const supabase = await createClient();
  const { data: updated, error } = await supabase
    .from("team_members")
    .update({ role })
    .eq("id", member_id)
    .eq("account_owner_id", account_owner_id)
    .neq("role", "owner") // structural owner-row protection — mirrors the DB guard
    .neq("status", "revoked")
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: "Could not change the role. Give it another try." };
  }
  if (!updated) {
    return { error: "That member can't be changed." };
  }

  console.warn(
    `[team] role CHANGED account=${account_owner_id} member=${member_id} new_role=${role} by=${user.id}`,
  );
  revalidatePath(SETTINGS_TEAM_PATH);
  return { success: "Role updated." };
}

/**
 * Revoke a team member's access (sets status → "revoked").
 *
 * Owners can never be revoked (enforced by .neq("role", "owner") below and by
 * the DB trigger). Members cannot revoke themselves through this action.
 */
export async function revokeMemberAccess(
  _prev: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;

  const rejected = unknownFieldError(formData, ["account_owner_id", "member_id"]);
  if (rejected) return rejected;

  const parsed = teamRevokeSchema.safeParse({
    account_owner_id: String(formData.get("account_owner_id") ?? ""),
    member_id: String(formData.get("member_id") ?? ""),
  });
  if (!parsed.success) return firstIssue(parsed.error);

  const { account_owner_id, member_id } = parsed.data;

  const actorRole = await getActorRole(account_owner_id);
  if (!can(actorRole, "team.revoke")) {
    return { error: "You don't have permission to remove members." };
  }

  // Fetch the target row to check if the actor is revoking themselves.
  const supabase = await createClient();
  const { data: target, error: fetchError } = await supabase
    .from("team_members")
    .select("id, member_user_id")
    .eq("id", member_id)
    .eq("account_owner_id", account_owner_id)
    .maybeSingle();

  if (fetchError || !target) {
    return { error: "Member not found." };
  }
  if (target.member_user_id === user.id) {
    return { error: "You can't remove yourself." };
  }

  const { data: updated, error } = await supabase
    .from("team_members")
    .update({ status: "revoked" })
    .eq("id", member_id)
    .eq("account_owner_id", account_owner_id)
    .neq("role", "owner") // structural owner-row protection — mirrors the DB guard
    .neq("status", "revoked")
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: "Could not remove the member. Give it another try." };
  }
  if (!updated) {
    return { error: "That member can't be removed." };
  }

  console.warn(
    `[team] access REVOKED account=${account_owner_id} member=${member_id} by=${user.id}`,
  );
  revalidatePath(SETTINGS_TEAM_PATH);
  return { success: "Member removed." };
}

// ---------------------------------------------------------------------------
// Active account (store switching)
// ---------------------------------------------------------------------------

const accountIdSchema = z.uuid();

/**
 * Switch the dashboard to operate on `accountId` (your own store, or a store you
 * actively belong to). Server-authoritative: the target is only accepted if it's
 * your own id or one where team_actor_role confirms an active membership — a
 * tampered value is ignored. Persisted in a cookie that getActiveAccount()
 * re-validates on every request; RLS is the real access boundary regardless.
 */
export async function setActiveAccount(
  accountId: string,
): Promise<{ ok: boolean }> {
  const user = await getUser();
  if (!user) return { ok: false };
  if (!accountIdSchema.safeParse(accountId).success) return { ok: false };

  if (accountId !== user.id) {
    const role = await getActorRole(accountId);
    if (!role) return { ok: false }; // not a member — refuse to switch
  }

  const store = await cookies();
  store.set(ACTIVE_ACCOUNT_COOKIE, accountId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  // Everything under the dashboard reads account-scoped data — refresh it all.
  revalidatePath("/", "layout");
  return { ok: true };
}
