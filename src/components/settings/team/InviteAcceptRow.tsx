"use client";

import * as React from "react";
import { useActionState } from "react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { ROLE_LABELS } from "@/lib/team/permissions";
import type { PendingInviteRow } from "@/lib/team/queries";
import { acceptInvite } from "@/lib/team/actions";

type TeamActionState = { error?: string; success?: string };

const INITIAL: TeamActionState = {};

/**
 * One pending-invite row with an Accept action. Shared by the persistent
 * "Invites for you" card and the auto-opening invite modal so both surfaces
 * behave identically. Acceptance is server-authoritative (acceptInvite →
 * team_accept_invite RPC); this only submits the invite id.
 *
 * `onAccepted` (optional) fires once when the accept succeeds, so a host (the
 * modal) can converge its own UI even if server revalidation is delayed/failed.
 */
export function InviteAcceptRow({
  invite,
  onAccepted,
}: {
  invite: PendingInviteRow;
  onAccepted?: () => void;
}) {
  const [state, formAction, isPending] = useActionState(acceptInvite, INITIAL);

  const firedRef = React.useRef(false);
  React.useEffect(() => {
    if (state.success && !firedRef.current) {
      firedRef.current = true;
      onAccepted?.();
    }
  }, [state.success, onAccepted]);

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">
          <span className="font-semibold">{invite.store_name}</span> invited you
          as <span className="font-semibold">{ROLE_LABELS[invite.role]}</span>
        </p>
        <p className="font-inter text-xs text-muted-foreground">
          {new Date(invite.invited_at).toLocaleDateString()}
        </p>
        <FormStatus state={state} showSuccess />
      </div>
      <form action={formAction} className="shrink-0">
        <input type="hidden" name="invite_id" value={invite.id} />
        <SaveButton
          type="submit"
          pending={isPending}
          state={state}
          pendingLabel="Accepting…"
          savedLabel="Accepted"
        >
          Accept
        </SaveButton>
      </form>
    </div>
  );
}
