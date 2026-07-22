"use client";

import * as React from "react";
import { UserPlus } from "lucide-react";
import { MemberList } from "@/components/settings/team/MemberList";
import { InviteModal } from "@/components/settings/team/InviteModal";
import { InvitePromptModal } from "@/components/settings/team/InvitePromptModal";
import { PendingInvites } from "@/components/settings/team/PendingInvites";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { Button } from "@/components/ui/button";
import { can } from "@/lib/team/permissions";
import type { TeamRole } from "@/lib/team/permissions";
import type { TeamMemberRow, PendingInviteRow } from "@/lib/team/queries";

export function TeamSection({
  accountOwnerId,
  actorRole,
  members,
  pendingInvites,
  viewerUserId,
}: {
  accountOwnerId: string;
  actorRole: TeamRole | null;
  members: TeamMemberRow[];
  pendingInvites: PendingInviteRow[];
  /** The signed-in user, so their own row can be marked "(you)". */
  viewerUserId?: string | null;
}) {
  const [inviteOpen, setInviteOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-6">
      {/* Auto-opening prompt so a pending invite is impossible to miss (also the
          landing surface for the invite notification's deep link). */}
      <InvitePromptModal invites={pendingInvites} />

      {pendingInvites.length > 0 && (
        <PendingInvites invites={pendingInvites} />
      )}

      <SettingsCard
        title="Team"
        description="People who can sign in to this store. Their role controls what they can see and change."
      >
        <MemberList
          accountOwnerId={accountOwnerId}
          actorRole={actorRole}
          members={members}
          viewerUserId={viewerUserId}
        />

        {can(actorRole, "team.invite") && (
          <div className="mt-5">
            <Button
              type="button"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus aria-hidden className="size-4" />
              Invite member
            </Button>
          </div>
        )}
      </SettingsCard>

      <InviteModal
        accountOwnerId={accountOwnerId}
        actorRole={actorRole}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
      />
    </div>
  );
}
