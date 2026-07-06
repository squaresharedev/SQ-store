import { MemberRow } from "@/components/settings/team/MemberRow";
import type { TeamRole } from "@/lib/team/permissions";
import type { TeamMemberRow } from "@/lib/team/queries";

export function MemberList({
  accountOwnerId,
  actorRole,
  members,
}: {
  accountOwnerId: string;
  actorRole: TeamRole | null;
  members: TeamMemberRow[];
}) {
  // The owner row is always present; "just you" means only the owner.
  const onlyOwner =
    members.length === 0 ||
    (members.length === 1 && members[0]?.role === "owner");

  return (
    <div>
      <ul className="divide-y divide-neutral-100">
        {members.map((member) => (
          <li key={member.id}>
            <MemberRow
              accountOwnerId={accountOwnerId}
              actorRole={actorRole}
              member={member}
            />
          </li>
        ))}
      </ul>

      {onlyOwner && (
        <p className="mt-4 font-inter text-sm text-neutral-400">
          Just you so far. Invite someone.
        </p>
      )}

      {members.length >= 50 && (
        <p className="mt-3 font-inter text-sm text-neutral-400">
          Showing the first 50 members.
        </p>
      )}
    </div>
  );
}
