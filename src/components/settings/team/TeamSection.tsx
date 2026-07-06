"use client";

import * as React from "react";
import { UserPlus } from "lucide-react";
import { MemberList } from "@/components/settings/team/MemberList";
import { InviteModal } from "@/components/settings/team/InviteModal";
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
}: {
  accountOwnerId: string;
  actorRole: TeamRole | null;
  members: TeamMemberRow[];
  pendingInvites: PendingInviteRow[];
}) {
  const [inviteOpen, setInviteOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-6">
      {pendingInvites.length > 0 && (
        <PendingInvites invites={pendingInvites} />
      )}

      <SettingsCard
        title="Team"
        description="Everyone listed here can sign in and access this store. Roles control what they can see and do."
      >
        <MemberList
          accountOwnerId={accountOwnerId}
          actorRole={actorRole}
          members={members}
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
