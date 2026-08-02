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
import { fetchTeamRosterPage } from "@/lib/team/actions";

export function TeamSection({
  accountOwnerId,
  actorRole,
  members,
  pageSize,
  pendingInvites,
  viewerUserId,
}: {
  accountOwnerId: string;
  actorRole: TeamRole | null;
  members: TeamMemberRow[];
  /** Server page size (TEAM_PAGE_SIZE); a full first page means possibly more. */
  pageSize: number;
  pendingInvites: PendingInviteRow[];
  /** The signed-in user, so their own row can be marked "(you)". */
  viewerUserId?: string | null;
}) {
  const [inviteOpen, setInviteOpen] = React.useState(false);

  // Roster paging: the page seeds one server page; anything beyond it loads on
  // demand. Without this, members 51+ simply did not appear, with no signal.
  const [rows, setRows] = React.useState<TeamMemberRow[]>(members);
  const [hasMore, setHasMore] = React.useState(members.length >= pageSize);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadError, setLoadError] = React.useState(false);

  // Adopt fresh server props after a revalidation (invite/role mutations
  // revalidate the page); local paging state resets with them.
  const [prevMembers, setPrevMembers] = React.useState(members);
  if (members !== prevMembers) {
    setPrevMembers(members);
    setRows(members);
    setHasMore(members.length >= pageSize);
  }

  async function loadMore() {
    if (loadingMore) return;
    setLoadingMore(true);
    setLoadError(false);
    try {
      const next = await fetchTeamRosterPage(accountOwnerId, rows.length);
      setRows((current) => {
        const seen = new Set(current.map((m) => m.id));
        return [...current, ...next.filter((m) => !seen.has(m.id))];
      });
      setHasMore(next.length >= pageSize);
    } catch {
      // Keep hasMore true: the same click retries.
      setLoadError(true);
    } finally {
      setLoadingMore(false);
    }
  }

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
          members={rows}
          viewerUserId={viewerUserId}
        />

        {hasMore && (
          <div className="mt-3 flex flex-col items-start gap-1.5">
            {loadError && (
              <p role="alert" className="font-inter text-sm text-destructive">
                Couldn&apos;t load more members. Try again.
              </p>
            )}
            <Button
              type="button"
              variant="ghost"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : loadError ? "Try again" : "Load more members"}
            </Button>
          </div>
        )}

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
