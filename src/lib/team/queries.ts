import { createClient } from "@/lib/supabase/server";
import type { TeamRole, TeamMemberStatus } from "@/lib/team/permissions";

/**
 * Server-side read helpers for Team & Access.
 *
 * All three functions call SECURITY DEFINER RPCs that are self-gated (RLS
 * applies inside them).
 *
 * Error convention: the PAGE reads (roster, pending invites) THROW so a DB
 * failure reaches error.tsx as an error, not as a calm "just you" roster the
 * owner cannot tell apart from reality. getActorRole is the exception: it is
 * an authorization probe consumed by server actions, and there null means
 * "no permission", which is the correct fail-closed answer when the check
 * itself cannot run.
 *
 * The generated Supabase types for `team_roster` wrongly mark `display_name`,
 * `member_user_id`, and `accepted_at` as non-null. We cast each RPC result to
 * our own row type (below) which reflects the real nullability.
 *
 * CONTRACT: export names and shapes below are consumed by the UI agent in
 * parallel. Do not rename or change the types without coordinating.
 */

export type TeamMemberRow = {
  id: string;
  member_user_id: string | null;
  invited_email: string;
  role: TeamRole;
  status: TeamMemberStatus;
  invited_at: string;
  accepted_at: string | null;
  display_name: string | null;
  /** Public avatars-bucket URL, or null when they haven't set a photo. */
  avatar_url: string | null;
};

export type PendingInviteRow = {
  id: string;
  account_owner_id: string;
  role: TeamRole;
  invited_at: string;
  store_name: string;
};

export const TEAM_PAGE_SIZE = 50;

/**
 * Returns the team roster for `accountOwnerId` as seen by the calling user.
 * The RPC returns an empty array for callers who are not active members.
 */
export async function getTeamRoster(
  accountOwnerId: string,
  opts?: { limit?: number; offset?: number },
): Promise<TeamMemberRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_roster", {
    account: accountOwnerId,
    page_limit: opts?.limit ?? TEAM_PAGE_SIZE,
    page_offset: opts?.offset ?? 0,
  });
  if (error) {
    // A swallowed error renders as "just you", which for a real team is
    // indistinguishable from everyone having been removed.
    throw new Error(`The team roster is unavailable right now: ${error.message}`);
  }
  // Cast: generated types wrongly mark display_name / member_user_id /
  // accepted_at as non-null. Our TeamMemberRow declares them nullable.
  return (data ?? []) as TeamMemberRow[];
}

/**
 * Returns all pending invites addressed to the calling user's verified email.
 * Safe to call even when the user has no team memberships.
 */
export async function getMyPendingInvites(): Promise<PendingInviteRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_my_pending_invites");
  if (error) {
    // Swallowing here made pending invites silently vanish on failure.
    throw new Error(`Pending invites are unavailable right now: ${error.message}`);
  }
  return (data ?? []) as PendingInviteRow[];
}

/**
 * Returns the calling user's active role on `accountOwnerId`'s store, or null
 * if they are not an active member. This is the authoritative server-side
 * actor-role lookup used by server actions before every mutation.
 */
export async function getActorRole(
  accountOwnerId: string,
): Promise<TeamRole | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("team_actor_role", {
    account: accountOwnerId,
  });
  if (error) {
    console.warn("[team] getActorRole error", error.message);
    return null;
  }
  return (data as TeamRole) ?? null;
}
