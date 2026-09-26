import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile, getUser } from "@/lib/auth/session";
import { createNotification } from "@/lib/notifications/create";
import { actionError, invalidInput, type ActionError } from "@/lib/errors";
import { msg } from "@/i18n/types";

/**
 * ACCEPTING A TEAM INVITE: the one implementation.
 *
 * Two surfaces accept invites: the Team & access page (the `acceptInvite` form
 * action) and the Accept button on the invite's notification (the
 * `runNotificationAction` action). Both land here, so there is exactly one set
 * of checks between a click and a new store member, and a fix to one surface
 * cannot leave the other behind.
 *
 * Deliberately NOT in a "use server" module: exporting it from one would make
 * it an endpoint of its own. The callers are the endpoints; they validate
 * their input and pass a parsed invite id.
 *
 * We perform an identity check here (invited_email === user.email) in addition
 * to what the DB enforces, so the user gets a friendly error rather than a raw
 * Postgres exception if something is off.
 */

const SETTINGS_TEAM_PATH = "/settings/team";

export type AcceptInviteResult =
  | { ok: true; accountOwnerId: string }
  | {
      ok: false;
      error: ActionError;
      /** The store the invite was for, when the invite could be read. */
      accountOwnerId: string | null;
    };

export async function acceptTeamInvite(inviteId: string): Promise<AcceptInviteResult> {
  const user = await getUser();
  if (!user) {
    return {
      ok: false,
      error: actionError("session_expired", msg("Errors.form.sessionExpired")),
      accountOwnerId: null,
    };
  }
  if (!user.email) {
    return { ok: false, error: invalidInput(msg("Errors.team.noVerifiedEmail")), accountOwnerId: null };
  }

  const supabase = await createClient();

  // Fetch the invite row — RLS permits the invitee to read their own pending
  // invites, so a missing row means it doesn't exist or isn't theirs.
  const { data: invite, error: fetchError } = await supabase
    .from("team_members")
    .select("id, status, invited_email, account_owner_id")
    .eq("id", inviteId)
    .maybeSingle();

  if (fetchError || !invite) {
    return {
      ok: false,
      error: actionError("not_found", msg("Errors.team.inviteNotFound")),
      accountOwnerId: null,
    };
  }

  // Server-side identity check before touching the row.
  if (invite.status !== "invited") {
    return {
      ok: false,
      error: invalidInput(msg("Errors.team.inviteUsed")),
      accountOwnerId: invite.account_owner_id,
    };
  }
  if (invite.invited_email !== user.email.toLowerCase()) {
    return {
      ok: false,
      error: actionError("permission_denied", msg("Errors.team.inviteWrongEmail")),
      accountOwnerId: null,
    };
  }

  // Acceptance is an atomic, server-authoritative RPC: it re-verifies the JWT
  // email matches invited_email and binds member_user_id = auth.uid() as the
  // account owner (definer), with the guard trigger re-checking the same. The
  // pre-checks above only exist to return friendly errors.
  const { data: accepted, error: rpcError } = await supabase.rpc(
    "team_accept_invite",
    { p_invite_id: inviteId },
  );

  if (rpcError || !accepted) {
    return {
      ok: false,
      error: actionError("server_error", msg("Errors.team.acceptFailed")),
      accountOwnerId: invite.account_owner_id,
    };
  }

  console.warn(
    `[team] invite ACCEPTED invite_id=${inviteId} user_id=${user.id}`,
  );

  // Notify the store owner that someone joined their team. Best-effort — a
  // notification failure must never fail the accept (createNotification never
  // throws and returns false on error).
  const profile = await getProfile();
  const joinerName = profile?.username?.trim() || user.email?.split("@")[0];
  await createNotification({
    userId: invite.account_owner_id,
    type: "team",
    message: {
      title: joinerName
        ? { key: "Notifications.messages.teamJoined.title", values: { name: joinerName } }
        : { key: "Notifications.messages.teamJoined.titleUnnamed" },
      body: { key: "Notifications.messages.teamJoined.body" },
    },
    data: { href: SETTINGS_TEAM_PATH },
  });

  revalidatePath(SETTINGS_TEAM_PATH);
  return { ok: true, accountOwnerId: invite.account_owner_id };
}
