"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { InviteAcceptRow } from "@/components/settings/team/InviteAcceptRow";
import type { PendingInviteRow } from "@/lib/team/queries";

/**
 * Attention-grabbing invite prompt: auto-opens on the Team & access page when
 * the signed-in user has pending invites, so an invite is impossible to miss
 * (the persistent "Invites for you" card remains underneath). Dismissible; it
 * won't nag again within the same visit once closed. Acceptance flows through
 * the shared InviteAcceptRow, so it's the same server-authoritative path as the
 * card. Deep-linked here from the invite notification's bell entry.
 */
export function InvitePromptModal({ invites }: { invites: PendingInviteRow[] }) {
  // Auto-open once per mount; dismissing sticks for the visit.
  const [open, setOpen] = React.useState(true);

  // Converge client-side when an invite is accepted, so the prompt closes even
  // if server revalidation is slow or fails (leaving a stale accepted row). A
  // short delay lets the row's "Accepted" state show first.
  const closeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    },
    [],
  );
  function handleAccepted() {
    if (closeTimerRef.current) return;
    closeTimerRef.current = setTimeout(() => setOpen(false), 1200);
  }

  if (invites.length === 0) return null;

  const plural = invites.length > 1;

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={plural ? "You have team invites" : "You have a team invite"}
      description={
        plural
          ? "You've been invited to join these teams. Accept to get access."
          : "You've been invited to join a team. Accept to get access."
      }
    >
      <ul className="divide-y divide-border">
        {invites.map((invite) => (
          <li key={invite.id}>
            <InviteAcceptRow invite={invite} onAccepted={handleAccepted} />
          </li>
        ))}
      </ul>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-[0.375rem] px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Maybe later
        </button>
      </div>
    </Modal>
  );
}
