"use client";

import * as React from "react";
import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { infoTextClass } from "@/components/ui/control-styles";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { SaveButton } from "@/components/ui/SaveButton";
import type { PendingInviteRow } from "@/lib/team/queries";
import { acceptInvite } from "@/lib/team/actions";
import type { ActionState } from "@/lib/errors";
import { formatNumericDate } from "@/lib/format/date";

const INITIAL: ActionState = {};

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
  const t = useTranslations("Settings.team.inviteRow");
  const locale = useLocale();
  const [state, formAction, isPending] = useActionState(acceptInvite, INITIAL);
  // The row can be inside the auto-opening prompt, which closes itself once an
  // invite is accepted. The confirmation has to survive that.
  useActionStateToast(state);
  const saveResult = useSaveResult(state);

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
          {t.rich("invitedAs", {
            storeName: invite.store_name,
            role: invite.role,
            store: (chunks) => <span className="font-semibold">{chunks}</span>,
            strong: (chunks) => <span className="font-semibold">{chunks}</span>,
          })}
        </p>
        <p className={infoTextClass}>
          {formatNumericDate(invite.invited_at, locale)}
        </p>
      </div>
      <form action={formAction} className="shrink-0">
        <input type="hidden" name="invite_id" value={invite.id} />
        <SaveButton
          type="submit"
          pending={isPending}
          state={saveResult}
          pendingLabel={t("accepting")}
          savedLabel={t("accepted")}
        >
          {t("acceptButton")}
        </SaveButton>
      </form>
    </div>
  );
}
