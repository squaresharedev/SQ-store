import { helpTextClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { MemberRow, usernameFor } from "@/components/settings/team/MemberRow";
import type { TeamRole } from "@/lib/team/permissions";
import type { TeamMemberRow } from "@/lib/team/queries";

/** Owner first, then editors, then viewers; alphabetical inside each rank. */
const ROLE_ORDER: Record<TeamRole, number> = { owner: 0, editor: 1, viewer: 2 };

function byRoleThenName(a: TeamMemberRow, b: TeamMemberRow): number {
  const rank = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
  if (rank !== 0) return rank;
  return usernameFor(a).localeCompare(usernameFor(b), undefined, {
    sensitivity: "base",
  });
}

/**
 * The roster, split by what it actually means for access:
 *
 *   - ACTIVE members can sign in today. These are "the team".
 *   - INVITED people cannot — the invite only takes effect when they sign in.
 *     Listing them alongside members contradicted the card's own promise that
 *     "everyone listed here can sign in", so they get their own group.
 *   - REVOKED people are not shown at all. They have no access, so leaving a
 *     greyed-out row behind read as "did the removal work?" rather than as
 *     information. Re-inviting is the way back.
 */
export function MemberList({
  accountOwnerId,
  actorRole,
  members,
  viewerUserId,
}: {
  accountOwnerId: string;
  actorRole: TeamRole | null;
  members: TeamMemberRow[];
  /** Marks the viewer's own row with "(you)". */
  viewerUserId?: string | null;
}) {
  const active = members.filter((m) => m.status === "active").sort(byRoleThenName);
  const invited = members.filter((m) => m.status === "invited").sort(byRoleThenName);

  const onlyOwner = active.length <= 1 && invited.length === 0;

  return (
    <div>
      <ul className="divide-y divide-border border-b border-border">
        {active.map((member) => (
          <li key={member.id}>
            <MemberRow
              accountOwnerId={accountOwnerId}
              actorRole={actorRole}
              member={member}
              isSelf={
                viewerUserId != null && member.member_user_id === viewerUserId
              }
            />
          </li>
        ))}
      </ul>

      {onlyOwner && (
        <p className="pt-4 font-inter text-sm text-muted-foreground">
          It&apos;s just you so far. Invite someone to give them access.
        </p>
      )}

      {invited.length > 0 && (
        <div className="pt-6">
          <h3 className="font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Invited
          </h3>
          <p className={cn(helpTextClass, "mt-1")}>
            No access yet — an invite takes effect the first time they sign in
            with that email address.
          </p>
          <ul className="mt-1 divide-y divide-border border-b border-border">
            {invited.map((member) => (
              <li key={member.id}>
                <MemberRow
                  accountOwnerId={accountOwnerId}
                  actorRole={actorRole}
                  member={member}
                  variant="invite"
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {members.length >= 50 && (
        <p className="pt-3 font-inter text-sm text-muted-foreground">
          Showing the first 50 members.
        </p>
      )}
    </div>
  );
}
