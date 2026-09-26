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
import { STEP_UP_FIELDS, requireStepUpState } from "@/lib/auth/mfa";
import { createNotification, resolveUserIdByEmail } from "@/lib/notifications/create";
import type { StoredNotificationAction } from "@/lib/notifications/inline-actions";
import { acceptTeamInvite } from "@/lib/team/accept";
import { can, canGrant } from "@/lib/team/permissions";
import {
  getActorRole,
  getTeamRoster,
  type TeamMemberRow,
} from "@/lib/team/queries";
import { ACTIVE_ACCOUNT_COOKIE } from "@/lib/team/account-context";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import {
  teamInviteSchema,
  teamAcceptSchema,
  teamChangeRoleSchema,
  teamRevokeSchema,
} from "@/lib/validation/team";
import { firstIssue } from "@/lib/validation/messages";
import {
  actionError,
  failed,
  invalidInput,
  succeeded,
  type ActionState,
} from "@/lib/errors";
import { msg } from "@/i18n/types";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Module-local helpers (mirrors the pattern in lib/settings/actions.ts)
// ---------------------------------------------------------------------------

const SIGNED_OUT: ActionState = failed(
  actionError("session_expired", msg("Errors.form.sessionExpired")),
);

/**
 * FIELD WHITELIST guard: reject any submitted field not explicitly expected.
 * React's own `$ACTION_*` bookkeeping keys are always skipped.
 */
function unknownFieldError(
  formData: FormData,
  allowed: readonly string[],
): ActionState | null {
  for (const key of formData.keys()) {
    if (key.startsWith("$ACTION")) continue;
    if (!allowed.includes(key)) {
      return failed(invalidInput(msg("Errors.form.unexpectedField", { field: key })));
    }
  }
  return null;
}

function invalid(error: z.ZodError): ActionState {
  return failed(invalidInput(firstIssue(error)));
}

const MEMBERSHIP_RATE_LIMITED: ActionState = failed(
  actionError("rate_limited", msg("Errors.team.membershipRateLimited")),
);

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
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;

  const rejected = unknownFieldError(formData, [
    "account_owner_id",
    "invited_email",
    "role",
    ...STEP_UP_FIELDS,
  ]);
  if (rejected) return rejected;

  const parsed = teamInviteSchema.safeParse({
    account_owner_id: String(formData.get("account_owner_id") ?? ""),
    invited_email: String(formData.get("invited_email") ?? ""),
    role: String(formData.get("role") ?? ""),
  });
  if (!parsed.success) return invalid(parsed.error);

  const { account_owner_id, invited_email, role } = parsed.data;

  // DB-authoritative actor role — never trust a role claim from the client.
  const actorRole = await getActorRole(account_owner_id);
  if (!can(actorRole, "team.invite")) {
    return failed(actionError("permission_denied", msg("Errors.team.noInvitePermission")));
  }
  if (!canGrant(actorRole, role)) {
    return failed(actionError("permission_denied", msg("Errors.team.inviteRoleTooHigh")));
  }

  // Block inviting yourself — you're already here.
  if (user.email && invited_email === user.email.toLowerCase()) {
    return failed(invalidInput(msg("Errors.team.inviteSelf")));
  }

  // Granting someone access to the store is how an intruder keeps a way in
  // after the owner changes their password, so with 2FA on it takes a recent
  // code. After the permission checks: nobody without invite rights ever
  // spends a second-factor attempt here.
  const stepUp = await requireStepUpState(formData);
  if (stepUp) return stepUp;

  // An invite notifies (and will email) an arbitrary address of the inviter's
  // choosing, so it is the main in-app path for spamming a stranger. Keyed on
  // auth.uid() inside Postgres, so it cannot be shaken off by rotating IP or
  // clearing cookies, and the sliding window means a burst cannot be repeated
  // by waiting for a boundary. Checked AFTER the permission checks so a user
  // without invite rights can never spend the budget.
  if (!(await rateLimit("team_invite", RATE_LIMITS.teamInvite))) {
    return failed(actionError("rate_limited", msg("Errors.team.inviteRateLimited")));
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
      return failed(invalidInput(msg("Errors.team.alreadyInvited")));
    }
    return failed(actionError("server_error", msg("Errors.team.inviteFailed")));
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
      const store = inviterProfile?.username?.trim();
      // The invite's id makes the notification ACTIONABLE: an Accept button
      // on the row itself (lib/notifications/inline-actions.ts). Read back
      // here rather than with insert(...).select(), so that a read problem
      // can only cost the button, never the invite already written above.
      // (account, email) is unique, so this is the row just inserted.
      const { data: created } = await supabase
        .from("team_members")
        .select("id")
        .eq("account_owner_id", account_owner_id)
        .eq("invited_email", invited_email)
        .eq("status", "invited")
        .maybeSingle();
      await createNotification({
        userId: inviteeUserId,
        type: "team",
        message: {
          title: { key: "Notifications.messages.teamInvite.title" },
          body: store
            ? { key: "Notifications.messages.teamInvite.body", values: { store, role } }
            : { key: "Notifications.messages.teamInvite.bodyUnnamedStore", values: { role } },
        },
        data: {
          href: SETTINGS_TEAM_PATH,
          ...(created?.id
            ? {
                action: {
                  kind: "team.acceptInvite",
                  inviteId: created.id,
                  accountOwnerId: account_owner_id,
                } satisfies StoredNotificationAction,
              }
            : {}),
        },
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
  return succeeded(msg("Settings.team.success.inviteCreated"));
}

/**
 * Accept a pending invite addressed to the calling user's verified email.
 *
 * The form half only: field whitelist and parse. The checks and the accept
 * itself live in acceptTeamInvite (lib/team/accept.ts), shared with the
 * Accept button on the invite's notification.
 */
export async function acceptInvite(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;
  if (!user.email) {
    return failed(invalidInput(msg("Errors.team.noVerifiedEmail")));
  }

  const rejected = unknownFieldError(formData, ["invite_id"]);
  if (rejected) return rejected;

  const parsed = teamAcceptSchema.safeParse({
    invite_id: String(formData.get("invite_id") ?? ""),
  });
  if (!parsed.success) return invalid(parsed.error);

  const result = await acceptTeamInvite(parsed.data.invite_id);
  if (!result.ok) return failed(result.error);
  return succeeded(msg("Settings.team.success.inviteAccepted"));
}

/**
 * Change the role of an existing active or invited team member.
 *
 * The actor must hold `team.change_role` AND be able to grant the target role
 * (no elevating members above your own rank). The DB trigger enforces the same
 * rules as a backstop.
 */
export async function changeMemberRole(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;

  const rejected = unknownFieldError(formData, [
    "account_owner_id",
    "member_id",
    "role",
    ...STEP_UP_FIELDS,
  ]);
  if (rejected) return rejected;

  const parsed = teamChangeRoleSchema.safeParse({
    account_owner_id: String(formData.get("account_owner_id") ?? ""),
    member_id: String(formData.get("member_id") ?? ""),
    role: String(formData.get("role") ?? ""),
  });
  if (!parsed.success) return invalid(parsed.error);

  const { account_owner_id, member_id, role } = parsed.data;

  const actorRole = await getActorRole(account_owner_id);
  if (!can(actorRole, "team.change_role")) {
    return failed(actionError("permission_denied", msg("Errors.team.noRolePermission")));
  }
  if (!(await rateLimit("team_membership", RATE_LIMITS.teamMembership))) {
    return MEMBERSHIP_RATE_LIMITED;
  }
  if (!canGrant(actorRole, role)) {
    return failed(actionError("permission_denied", msg("Errors.team.roleTooHigh")));
  }

  const stepUp = await requireStepUpState(formData);
  if (stepUp) return stepUp;

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
    return failed(actionError("server_error", msg("Errors.team.roleChangeFailed")));
  }
  if (!updated) {
    return failed(actionError("not_found", msg("Errors.team.memberNotChangeable")));
  }

  console.warn(
    `[team] role CHANGED account=${account_owner_id} member=${member_id} new_role=${role} by=${user.id}`,
  );
  revalidatePath(SETTINGS_TEAM_PATH);
  return succeeded(msg("Settings.team.success.roleUpdated"));
}

/**
 * Revoke a team member's access (sets status → "revoked").
 *
 * Owners can never be revoked (enforced by .neq("role", "owner") below and by
 * the DB trigger). Members cannot revoke themselves through this action.
 */
export async function revokeMemberAccess(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getUser();
  if (!user) return SIGNED_OUT;

  const rejected = unknownFieldError(formData, [
    "account_owner_id",
    "member_id",
    ...STEP_UP_FIELDS,
  ]);
  if (rejected) return rejected;

  const parsed = teamRevokeSchema.safeParse({
    account_owner_id: String(formData.get("account_owner_id") ?? ""),
    member_id: String(formData.get("member_id") ?? ""),
  });
  if (!parsed.success) return invalid(parsed.error);

  const { account_owner_id, member_id } = parsed.data;

  const actorRole = await getActorRole(account_owner_id);
  if (!can(actorRole, "team.revoke")) {
    return failed(actionError("permission_denied", msg("Errors.team.noRemovePermission")));
  }
  if (!(await rateLimit("team_membership", RATE_LIMITS.teamMembership))) {
    return MEMBERSHIP_RATE_LIMITED;
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
    return failed(actionError("not_found", msg("Errors.team.memberNotFound")));
  }
  if (target.member_user_id === user.id) {
    return failed(invalidInput(msg("Errors.team.removeSelf")));
  }

  const stepUp = await requireStepUpState(formData);
  if (stepUp) return stepUp;

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
    return failed(actionError("server_error", msg("Errors.team.removeFailed")));
  }
  if (!updated) {
    return failed(actionError("not_found", msg("Errors.team.memberNotRemovable")));
  }

  console.warn(
    `[team] access REVOKED account=${account_owner_id} member=${member_id} by=${user.id}`,
  );
  revalidatePath(SETTINGS_TEAM_PATH);
  return succeeded(msg("Settings.team.success.memberRemoved"));
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

/**
 * One further page of the roster, for the team page's "Load more". Read-only:
 * the team_roster RPC is self-gated (returns nothing to non-members), and the
 * offset is clamped server-side. Exists because the page seeds only the first
 * TEAM_PAGE_SIZE rows; without it, members 51+ were invisible with no
 * indicator, which for an owner reads as "these people are not on my team".
 */
export async function fetchTeamRosterPage(
  accountOwnerId: string,
  offset: number,
): Promise<TeamMemberRow[]> {
  const user = await getUser();
  if (!user) return [];
  if (!accountIdSchema.safeParse(accountOwnerId).success) return [];
  const safeOffset = Math.max(0, Math.trunc(offset));
  return getTeamRoster(accountOwnerId, { offset: safeOffset });
}
