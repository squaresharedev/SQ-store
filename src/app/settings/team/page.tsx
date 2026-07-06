import type { Metadata } from "next";
import { TeamSection } from "@/components/settings/team/TeamSection";
import { requireUser } from "@/lib/auth/session";
import {
  getActorRole,
  getMyPendingInvites,
  getTeamRoster,
} from "@/lib/team/queries";

export const metadata: Metadata = {
  title: "Team & access",
};

/**
 * Team & Access — PROTECTED. The roster shown is the signed-in user's OWN
 * store account (account_owner_id = their user id); they hold the seeded
 * "owner" role on it. Pending invites to OTHER stores surface at the top so a
 * member can accept and join.
 *
 * Everything here is server-authoritative: the roster, the actor's role and
 * the pending invites all come from self-gated RPCs under RLS, and every
 * mutation re-checks permissions server-side. The role passed to the UI only
 * decides which controls render — it is never the security boundary.
 */
export default async function TeamSettingsPage() {
  const user = await requireUser("/settings/team");
  const accountOwnerId = user.id;

  const [actorRole, members, pendingInvites] = await Promise.all([
    getActorRole(accountOwnerId),
    getTeamRoster(accountOwnerId),
    getMyPendingInvites(),
  ]);

  return (
    <TeamSection
      accountOwnerId={accountOwnerId}
      actorRole={actorRole}
      members={members}
      pendingInvites={pendingInvites}
    />
  );
}
