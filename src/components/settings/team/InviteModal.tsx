"use client";

import * as React from "react";
import { useActionState } from "react";
import { Mail } from "lucide-react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";
import {
  canGrant,
  ASSIGNABLE_ROLES,
  DEFAULT_INVITE_ROLE,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
} from "@/lib/team/permissions";
import type { TeamRole } from "@/lib/team/permissions";
import { inviteMember } from "@/lib/team/actions";

type TeamActionState = { error?: string; success?: string };

const INITIAL: TeamActionState = {};

export function InviteModal({
  accountOwnerId,
  actorRole,
  open,
  onClose,
}: {
  accountOwnerId: string;
  actorRole: TeamRole | null;
  open: boolean;
  onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState(inviteMember, INITIAL);
  const [email, setEmail] = React.useState("");
  const [selectedRole, setSelectedRole] = React.useState<"editor" | "viewer">(
    DEFAULT_INVITE_ROLE === "owner" ? "viewer" : (DEFAULT_INVITE_ROLE as "editor" | "viewer"),
  );

  const grantableOptions = ASSIGNABLE_ROLES.filter((r) =>
    canGrant(actorRole, r),
  );

  const roleSelectOptions: readonly SelectOption<"editor" | "viewer">[] =
    grantableOptions.map((r) => ({
      value: r,
      label: ROLE_LABELS[r],
      description: ROLE_DESCRIPTIONS[r],
    }));

  // Reset the email field once, each time a submit succeeds.
  const prevSuccess = React.useRef<string | undefined>(undefined);
  React.useEffect(() => {
    if (state.success && state.success !== prevSuccess.current) {
      setEmail("");
      prevSuccess.current = state.success;
    }
  }, [state.success]);

  if (grantableOptions.length === 0) return null;

  // Derive (don't store) the role that actually submits, so it's always one the
  // actor may grant even if `selectedRole` is stale — no effect/setState needed.
  const effectiveRole: "editor" | "viewer" = grantableOptions.includes(
    selectedRole,
  )
    ? selectedRole
    : (grantableOptions[0] as "editor" | "viewer");

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invite a member"
      description="They'll get access when they sign in with this email address."
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="account_owner_id" value={accountOwnerId} />
        <input type="hidden" name="role" value={effectiveRole} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">
            <Mail aria-hidden className="mr-1.5 inline size-3.5 align-text-bottom" />
            Email address
          </Label>
          <Input
            id="invite-email"
            name="invited_email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="colleague@example.com"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>

        {roleSelectOptions.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <Select
              id="invite-role"
              value={effectiveRole}
              options={roleSelectOptions}
              onChange={setSelectedRole}
              disabled={isPending}
            />
          </div>
        )}

        <FormStatus state={state} showSuccess />

        <p className="font-inter text-xs text-neutral-400">
          Email notifications aren&apos;t wired up yet — the invite takes effect
          when they sign in. You may want to let them know directly.
        </p>

        <div>
          <SaveButton
            type="submit"
            pending={isPending}
            state={state}
            pendingLabel="Sending…"
            savedLabel="Sent"
          >
            Send invite
          </SaveButton>
        </div>
      </form>
    </Modal>
  );
}
