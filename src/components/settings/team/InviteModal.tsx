"use client";

import * as React from "react";
import { useActionState } from "react";
import { Mail, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useActionStateToast, useSaveResult } from "@/components/ui/ActionErrorNotice";
import { Button } from "@/components/ui/button";
import { HeroMark } from "@/components/ui/HeroMark";
import { SaveButton } from "@/components/ui/SaveButton";
import { Modal, ModalActions } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { SelectOption } from "@/components/ui/select";
import { StepUpField } from "@/components/auth/StepUp";
import { SuccessMark } from "@/components/auth/SuccessMark";
import { usePlanLimitRedirect } from "@/components/billing/usePlanLimitRedirect";
import {
  canGrant,
  ASSIGNABLE_ROLES,
  DEFAULT_INVITE_ROLE,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
} from "@/lib/team/permissions";
import type { TeamRole } from "@/lib/team/permissions";
import { inviteMember, type InviteState } from "@/lib/team/actions";
import type { ActionState } from "@/lib/errors";

const INITIAL: InviteState = {};

/** The invite that just went out, as the "sent" view shows it. */
type SentInvite = NonNullable<InviteState["invited"]>;

export function InviteModal({
  accountOwnerId,
  actorRole,
  open,
  onClose,
  initialSent = null,
}: {
  accountOwnerId: string;
  actorRole: TeamRole | null;
  open: boolean;
  onClose: () => void;
  /** Open on the "sent" view, for the /dev/modals gallery. */
  initialSent?: SentInvite | null;
}) {
  const t = useTranslations();
  const [state, formAction, isPending] = useActionState(inviteMember, INITIAL);
  // A failure is toasted; a success is not, because the dialog itself turns
  // into the confirmation (below), right where the eye already is.
  useActionStateToast(state, { announceSuccess: false });
  const saveResult = useSaveResult(state);
  const toPlansFor = usePlanLimitRedirect();

  // Every seat on the plan is taken: the toast says why, and the plans page
  // takes this dialog's place, since a bigger plan is the way to add someone.
  const handledError = React.useRef<ActionState["error"]>(undefined);
  React.useEffect(() => {
    if (!state.error || state.error === handledError.current) return;
    handledError.current = state.error;
    if (toPlansFor(state.error)) onClose();
  }, [state.error, toPlansFor, onClose]);
  const [email, setEmail] = React.useState("");
  const [selectedRole, setSelectedRole] = React.useState<"editor" | "viewer">(DEFAULT_INVITE_ROLE);

  const grantableOptions = ASSIGNABLE_ROLES.filter((r) =>
    canGrant(actorRole, r),
  );

  const roleSelectOptions: readonly SelectOption<"editor" | "viewer">[] =
    grantableOptions.map((r) => ({
      value: r,
      label: t(ROLE_LABELS[r]),
      description: t(ROLE_DESCRIPTIONS[r]),
    }));

  // A sent invite turns the dialog into its confirmation: the opening mark
  // becomes the SuccessMark (same glyph, same size, so it lands on it), and
  // the address it went to is named. Watched by identity, because every
  // dispatch settles into a fresh state object, so a second invite in a row
  // shows its own confirmation. The email field empties for "Invite another".
  const [sent, setSent] = React.useState<SentInvite | null>(initialSent);
  const [seenState, setSeenState] = React.useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.invited) {
      setSent(state.invited);
      setEmail("");
    }
  }

  // Closing ends the confirmation, so the next open starts on a fresh form.
  const close = () => {
    setSent(null);
    onClose();
  };

  if (grantableOptions.length === 0) return null;

  // The same <Modal> at the same spot in both views, so swapping views keeps
  // the dialog mounted: no flash, no focus thrown back to the page behind.
  if (sent) {
    const title = t(
      sent.emailed
        ? "Settings.team.inviteModal.sent.title"
        : "Settings.team.inviteModal.sent.notEmailedTitle",
    );
    const body = t(
      sent.emailed
        ? "Settings.team.inviteModal.sent.body"
        : "Settings.team.inviteModal.sent.notEmailedBody",
      { email: sent.email },
    );
    return (
      <Modal
        open={open}
        onClose={close}
        visual={<SuccessMark kind="invite" size="md" />}
        title={title}
        description={body}
      >
        <div data-invite-state={sent.emailed ? "sent" : "created"}>
          {/* The visible header is not a live region, and the mark is
              decorative: this is what a screen reader hears when the form
              turns into the confirmation. */}
          <p role="status" className="sr-only">
            {title} {body}
          </p>
          <ModalActions>
            <Button type="button" variant="ghost" onClick={() => setSent(null)}>
              {t("Settings.team.inviteModal.sent.inviteAnother")}
            </Button>
            {/* autoFocus: the Send button that held focus is gone with the
                form, and focus must not fall to the page behind. */}
            <Button type="button" onClick={close} autoFocus>
              {t("Common.actions.done")}
            </Button>
          </ModalActions>
        </div>
      </Modal>
    );
  }

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
      onClose={close}
      visual={<HeroMark icon={UserPlus} />}
      title={t("Settings.team.inviteModal.title")}
      description={t("Settings.team.inviteModal.description")}
    >
      <form action={formAction} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="account_owner_id" value={accountOwnerId} />
        <input type="hidden" name="role" value={effectiveRole} />

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invite-email">
            <Mail aria-hidden className="mr-1.5 inline size-3.5 align-text-bottom" />
            {t("Settings.team.inviteModal.emailLabel")}
          </Label>
          <Input
            id="invite-email"
            name="invited_email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={t("Settings.team.inviteModal.emailPlaceholder")}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>

        {roleSelectOptions.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-role">{t("Settings.team.inviteModal.roleLabel")}</Label>
            <Select
              id="invite-role"
              value={effectiveRole}
              options={roleSelectOptions}
              onChange={setSelectedRole}
              disabled={isPending}
            />
          </div>
        )}

        <StepUpField id="invite-step-up" state={state} />

        <ModalActions>
          <Button type="button" variant="ghost" onClick={close}>
            {t("Common.actions.cancel")}
          </Button>
          <SaveButton
            type="submit"
            pending={isPending}
            state={saveResult}
            pendingLabel={t("Common.actions.sending")}
            savedLabel={t("Common.actions.sent")}
          >
            {t("Settings.team.inviteModal.sendButton")}
          </SaveButton>
        </ModalActions>
      </form>
    </Modal>
  );
}
