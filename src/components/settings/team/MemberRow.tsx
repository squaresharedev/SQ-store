"use client";

import * as React from "react";
import { useActionState } from "react";
import { Lock } from "lucide-react";
import { FormStatus } from "@/components/settings/FormStatus";
import { SaveButton } from "@/components/settings/SaveButton";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";
import {
  can,
  ASSIGNABLE_ROLES,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
} from "@/lib/team/permissions";
import type { TeamRole } from "@/lib/team/permissions";
import type { TeamMemberRow } from "@/lib/team/queries";
import {
  changeMemberRole,
  revokeMemberAccess,
} from "@/lib/team/actions";

type TeamActionState = { error?: string; success?: string };

const INITIAL: TeamActionState = {};

const ROLE_OPTIONS: readonly SelectOption<"editor" | "viewer">[] =
  ASSIGNABLE_ROLES.map((r) => ({
    value: r,
    label: ROLE_LABELS[r],
    description: ROLE_DESCRIPTIONS[r],
  }));

function displayNameFor(member: TeamMemberRow): string {
  if (member.display_name) return member.display_name;
  const at = member.invited_email.indexOf("@");
  return at > 0 ? member.invited_email.slice(0, at) : member.invited_email;
}

export function MemberRow({
  accountOwnerId,
  actorRole,
  member,
}: {
  accountOwnerId: string;
  actorRole: TeamRole | null;
  member: TeamMemberRow;
}) {
  const isOwner = member.role === "owner";
  const isRevoked = member.status === "revoked";

  // Role-change state
  const [pendingRole, setPendingRole] = React.useState<
    "editor" | "viewer" | null
  >(null);
  const [confirmMode, setConfirmMode] = React.useState<
    "role" | "revoke" | null
  >(null);

  const [roleState, roleAction, rolePending] = useActionState(
    changeMemberRole,
    INITIAL,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeMemberAccess,
    INITIAL,
  );

  const canChangeRole = !isOwner && !isRevoked && can(actorRole, "team.change_role");
  const canRevoke = !isOwner && !isRevoked && can(actorRole, "team.revoke");

  // Assignable options are always the full ASSIGNABLE_ROLES set; role guard is
  // on the actor permission, not filtered further here.
  const roleOptions = ROLE_OPTIONS as readonly SelectOption<"editor" | "viewer">[];

  const currentSelectValue: "editor" | "viewer" =
    member.role === "owner" ? "viewer" : (member.role as "editor" | "viewer");

  function handleRoleChange(value: "editor" | "viewer") {
    if (value === currentSelectValue) return;
    setPendingRole(value);
    setConfirmMode("role");
  }

  function cancelRoleChange() {
    setPendingRole(null);
    setConfirmMode(null);
  }

  function openRevokeConfirm() {
    setConfirmMode("revoke");
    setPendingRole(null);
  }

  function cancelRevoke() {
    setConfirmMode(null);
  }

  const displayedSelectValue =
    confirmMode === "role" && pendingRole ? pendingRole : currentSelectValue;

  return (
    <div
      className={[
        "flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:justify-between",
        isRevoked ? "opacity-60" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Left: identity */}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-neutral-900">
          {displayNameFor(member)}
        </p>
        <p className="font-inter text-sm text-neutral-500">
          {member.invited_email}
        </p>
      </div>

      {/* Right: role + status + controls */}
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
        {/* Role pill + status chips */}
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-[0.25rem] border border-neutral-200 px-2 py-0.5 font-inter text-xs font-medium uppercase tracking-wide text-neutral-600">
            {ROLE_LABELS[member.role]}
          </span>

          {member.status === "invited" && (
            <span className="inline-flex items-center rounded-[0.25rem] bg-neutral-100 px-2 py-0.5 font-inter text-xs text-neutral-500">
              Pending
            </span>
          )}

          {member.status === "revoked" && (
            <span className="inline-flex items-center rounded-[0.25rem] bg-red-50 px-2 py-0.5 font-inter text-xs text-red-500">
              Revoked
            </span>
          )}

          {isOwner && (
            <span
              title="The owner can't be edited or removed"
              className="inline-flex items-center text-neutral-400"
            >
              <Lock aria-label="Locked" className="size-3.5" />
            </span>
          )}
        </div>

        {/* Controls: role change + revoke */}
        {!isOwner && !isRevoked && (
          <div className="flex flex-col gap-2">
            {canChangeRole && confirmMode !== "revoke" && (
              <div className="flex items-center gap-2">
                <div className="w-36">
                  <Select
                    id={`role-${member.id}`}
                    value={displayedSelectValue}
                    options={roleOptions}
                    onChange={handleRoleChange}
                    disabled={rolePending}
                  />
                </div>
              </div>
            )}

            {/* Role change confirm row */}
            {confirmMode === "role" && pendingRole && (
              <form action={roleAction} className="flex flex-col gap-2">
                <input type="hidden" name="account_owner_id" value={accountOwnerId} />
                <input type="hidden" name="member_id" value={member.id} />
                <input type="hidden" name="role" value={pendingRole} />
                <div className="flex items-center gap-2">
                  <span className="font-inter text-sm text-neutral-700">
                    Change to {ROLE_LABELS[pendingRole]}?
                  </span>
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
                    onClick={cancelRoleChange}
                    disabled={rolePending}
                    className="px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </Button>
                </div>
                <FormStatus state={roleState} showSuccess />
              </form>
            )}

            {/* Revoke */}
            {canRevoke && confirmMode !== "role" && confirmMode !== "revoke" && (
              <button
                type="button"
                onClick={openRevokeConfirm}
                className="font-inter text-xs text-red-500 underline-offset-2 hover:underline"
              >
                Remove
              </button>
            )}

            {/* Revoke confirm row */}
            {confirmMode === "revoke" && (
              <form action={revokeAction} className="flex flex-col gap-2">
                <input type="hidden" name="account_owner_id" value={accountOwnerId} />
                <input type="hidden" name="member_id" value={member.id} />
                <p className="font-inter text-sm text-neutral-700">
                  Remove{" "}
                  <span className="font-medium">{displayNameFor(member)}</span>?
                  They lose access immediately.
                </p>
                <div className="flex items-center gap-2">
                  <SaveButton
                    type="submit"
                    variant="destructive"
                    pending={revokePending}
                    state={revokeState}
                    pendingLabel="Removing…"
                    savedLabel="Removed"
                  >
                    Confirm
                  </SaveButton>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={cancelRevoke}
                    disabled={revokePending}
                  >
                    Cancel
                  </Button>
                </div>
                <FormStatus state={revokeState} showSuccess />
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
