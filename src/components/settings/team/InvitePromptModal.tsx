"use client";

import * as React from "react";
import { UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HeroMark } from "@/components/ui/HeroMark";
import { Modal, ModalActions } from "@/components/ui/modal";
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
  const t = useTranslations("Settings.team.invitePrompt");
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

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      visual={<HeroMark icon={UserPlus} />}
      title={t("title", { count: invites.length })}
      description={t("description", { count: invites.length })}
    >
      <ul className="divide-y divide-border">
        {invites.map((invite) => (
          <li key={invite.id}>
            <InviteAcceptRow invite={invite} onAccepted={handleAccepted} />
          </li>
        ))}
      </ul>

      <ModalActions className="mt-4">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t("maybeLater")}
        </Button>
      </ModalActions>
    </Modal>
  );
}
