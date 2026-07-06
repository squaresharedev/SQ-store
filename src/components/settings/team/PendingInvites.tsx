"use client";

import { useActionState } from "react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { SettingsCard } from "@/components/settings/SettingsCard";
import { ROLE_LABELS } from "@/lib/team/permissions";
import type { PendingInviteRow } from "@/lib/team/queries";
import { acceptInvite } from "@/lib/team/actions";

type TeamActionState = { error?: string; success?: string };

const INITIAL: TeamActionState = {};

function AcceptRow({ invite }: { invite: PendingInviteRow }) {
  const [state, formAction, isPending] = useActionState(acceptInvite, INITIAL);

  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-neutral-900">
          <span className="font-semibold">{invite.store_name}</span> invited
          you as{" "}
          <span className="font-semibold">{ROLE_LABELS[invite.role]}</span>
        </p>
        <p className="font-inter text-xs text-neutral-400">
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

export function PendingInvites({ invites }: { invites: PendingInviteRow[] }) {
  return (
    <SettingsCard
      title="Invites for you"
      description="Accept an invite to join that store's team."
    >
      <ul className="divide-y divide-neutral-100">
        {invites.map((invite) => (
          <li key={invite.id}>
            <AcceptRow invite={invite} />
          </li>
        ))}
      </ul>
    </SettingsCard>
  );
}
