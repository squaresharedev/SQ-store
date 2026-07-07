"use client";

import { SettingsCard } from "@/components/settings/SettingsCard";
import { InviteAcceptRow } from "@/components/settings/team/InviteAcceptRow";
import type { PendingInviteRow } from "@/lib/team/queries";

/**
 * Persistent "Invites for you" card: the always-visible list of pending invites
 * addressed to the signed-in user. The invite modal (InvitePromptModal) is the
 * attention-grabbing counterpart; both share InviteAcceptRow.
 */
export function PendingInvites({ invites }: { invites: PendingInviteRow[] }) {
  return (
    <SettingsCard
      title="Invites for you"
      description="Accept an invite to join that store's team."
    >
      <ul className="divide-y divide-border">
        {invites.map((invite) => (
          <li key={invite.id}>
            <InviteAcceptRow invite={invite} />
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
