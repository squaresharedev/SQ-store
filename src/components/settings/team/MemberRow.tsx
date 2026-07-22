"use client";

import * as React from "react";
import { useActionState } from "react";
import { Crown, UserMinus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";
import { iconButtonClass } from "@/components/ui/control-styles";
import {
  can,
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
} from "@/lib/team/permissions";
import type { TeamRole } from "@/lib/team/permissions";
import type { TeamMemberRow } from "@/lib/team/queries";
import { changeMemberRole, revokeMemberAccess } from "@/lib/team/actions";

type TeamActionState = { error?: string; success?: string };

const INITIAL: TeamActionState = {};

/**
 * Confirms sit in their own quiet grey panel — borderless, so it reads as a
 * inset area belonging to this row rather than a second card competing with
 * the row above and below it.
 */
const CONFIRM_PANEL = "mt-3 flex flex-col gap-2 bg-muted px-4 py-3";

const ROLE_OPTIONS: readonly SelectOption<"editor" | "viewer">[] =
  ASSIGNABLE_ROLES.map((r) => ({
    value: r,
    label: ROLE_LABELS[r],
    description: ROLE_DESCRIPTIONS[r],
  }));

/** Name if we have one, else the local part of the email (never the raw uuid). */
export function displayNameFor(member: TeamMemberRow): string {
  if (member.display_name) return member.display_name;
  const at = member.invited_email.indexOf("@");
  return at > 0 ? member.invited_email.slice(0, at) : member.invited_email;
}

/**
 * One person on the team.
 *
 * ROLE IS SHOWN EXACTLY ONCE: a static pill when it can't be changed (the
 * owner, or when the viewer lacks `team.change_role`), or the select when it
 * can. Showing both — a pill that only restates the select's value — was pure
 * duplication and made the row read like two separate controls.
 *
 * Destructive actions stay behind an inline confirm, and the confirm replaces
 * the row's controls rather than stacking beneath them, so the row never grows
 * two competing affordances at once.
 */
export function MemberRow({
  accountOwnerId,
  actorRole,
  member,
  isSelf = false,
  /** Pending invites read as "cancel the invite", not "remove a teammate". */
  variant = "member",
}: {
  accountOwnerId: string;
  actorRole: TeamRole | null;
  member: TeamMemberRow;
  isSelf?: boolean;
  variant?: "member" | "invite";
}) {
  const isOwner = member.role === "owner";
  const name = displayNameFor(member);

  const [pendingRole, setPendingRole] = React.useState<"editor" | "viewer" | null>(null);
  const [confirmMode, setConfirmMode] = React.useState<"role" | "revoke" | null>(null);

  const [roleState, roleAction, rolePending] = useActionState(changeMemberRole, INITIAL);
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeMemberAccess,
    INITIAL,
  );

  // You can never change or remove the owner, nor remove yourself (the server
  // enforces both; this just keeps dead controls off the screen).
  const canChangeRole = !isOwner && can(actorRole, "team.change_role");
  const canRevoke = !isOwner && !isSelf && can(actorRole, "team.revoke");

  const currentRole: "editor" | "viewer" =
    member.role === "owner" ? "viewer" : (member.role as "editor" | "viewer");

  function handleRoleChange(value: "editor" | "viewer") {
    if (value === currentRole) return;
    setPendingRole(value);
    setConfirmMode("role");
  }

  function reset() {
    setPendingRole(null);
    setConfirmMode(null);
  }

  const selectValue = confirmMode === "role" && pendingRole ? pendingRole : currentRole;
  const confirming = confirmMode !== null;

  return (
    <div className="py-4">
      {/* Identity + controls stay on one line; a confirm opens BELOW them
          (full width) so the person's name and email never get squeezed or
          truncated by the question being asked about them. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {/* Real photo when they have one; initials are only the fallback. */}
        <Avatar src={member.avatar_url} name={name} className="size-9" />
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <span className="truncate">{name}</span>
            {isSelf && (
              <span className="shrink-0 font-inter text-xs font-normal text-muted-foreground">
                (you)
              </span>
            )}
          </p>
          <p className="truncate font-inter text-sm text-muted-foreground">
            {member.invited_email}
          </p>
        </div>
      </div>

      {/* Controls — one role representation, plus at most one destructive action. */}
      {!confirming && (
        <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0" data-testid="member-controls">
          {canChangeRole ? (
            <div className="w-32">
              <Select
                id={`role-${member.id}`}
                value={selectValue}
                options={ROLE_OPTIONS}
                onChange={handleRoleChange}
                disabled={rolePending}
                // Narrow trigger at the row's right edge: grow the panel inward.
                align="right"
                // Square corners and size-9 to match the remove button beside
                // it — py-0 so the height is the height, not padding + line-box.
                triggerClassName="h-9 rounded-none py-0 text-sm"
              />
            </div>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-[0.25rem] border border-border px-2 py-0.5 font-inter text-xs font-medium text-muted-foreground"
              title={ROLE_DESCRIPTIONS[member.role]}
            >
              {isOwner && (
                // Decorative: the label carries the meaning, so the gold is
                // free to be gold without owing anyone a contrast ratio.
                <Crown
                  className="size-3.5 shrink-0 text-crown dark:text-crown-dark"
                  fill="currentColor"
                  strokeWidth={1.5}
                  aria-hidden
                />
              )}
              {ROLE_LABELS[member.role]}
            </span>
          )}

          {canRevoke && (
            <button
              type="button"
              onClick={() => setConfirmMode("revoke")}
              aria-label={
                variant === "invite"
                  ? `Cancel the invite to ${member.invited_email}`
                  : `Remove ${name} from the team`
              }
              title={variant === "invite" ? "Cancel invite" : "Remove from team"}
              className={cn(iconButtonClass, "size-9 hover:border-destructive hover:text-destructive")}
            >
              {variant === "invite" ? (
                <X className="size-4" strokeWidth={2} aria-hidden />
              ) : (
                <UserMinus className="size-4" strokeWidth={2} aria-hidden />
              )}
            </button>
          )}
        </div>
      )}
      </div>

      {/* Role-change confirm */}
      {confirmMode === "role" && pendingRole && (
        <form action={roleAction} className={CONFIRM_PANEL}>
          <input type="hidden" name="account_owner_id" value={accountOwnerId} />
          <input type="hidden" name="member_id" value={member.id} />
          <input type="hidden" name="role" value={pendingRole} />
          <p className="font-inter text-sm text-foreground">
            Make {name} {ROLE_LABELS[pendingRole].toLowerCase()}?{" "}
            <span className="text-muted-foreground">
              {ROLE_DESCRIPTIONS[pendingRole]}
            </span>
          </p>
          <div className="flex items-center gap-2">
            <SaveButton
              type="submit"
              pending={rolePending}
              state={roleState}
              pendingLabel="Saving…"
              savedLabel="Done"
              className="px-3 py-1.5 text-xs"
            >
              Confirm
            </SaveButton>
            <Button
              type="button"
              variant="ghost"
              onClick={reset}
              disabled={rolePending}
              className="px-3 py-1.5 text-xs"
            >
              Cancel
            </Button>
          </div>
          <FormStatus state={roleState} />
        </form>
      )}

      {/* Remove / cancel-invite confirm */}
      {confirmMode === "revoke" && (
        <form action={revokeAction} className={CONFIRM_PANEL}>
          <input type="hidden" name="account_owner_id" value={accountOwnerId} />
          <input type="hidden" name="member_id" value={member.id} />
          <p className="font-inter text-sm text-foreground">
            {variant === "invite" ? (
              <>Cancel the invite to {member.invited_email}?</>
            ) : (
              <>Remove {name}? They lose access immediately.</>
            )}
          </p>
          <div className="flex items-center gap-2">
            <SaveButton
              type="submit"
              variant="destructive"
              pending={revokePending}
              state={revokeState}
              pendingLabel={variant === "invite" ? "Cancelling…" : "Removing…"}
              savedLabel={variant === "invite" ? "Cancelled" : "Removed"}
              className="px-3 py-1.5 text-xs"
            >
              {variant === "invite" ? "Cancel invite" : "Remove"}
            </SaveButton>
            <Button
              type="button"
              variant="ghost"
              onClick={reset}
              disabled={revokePending}
              className="px-3 py-1.5 text-xs"
            >
              Keep
            </Button>
          </div>
          <FormStatus state={revokeState} />
        </form>
      )}
    </div>
  );
}
