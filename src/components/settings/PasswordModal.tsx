"use client";

import * as React from "react";
import { useActionState } from "react";
import { Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { helpTextClass } from "@/components/ui/control-styles";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/Disclosure";
import { HeroMark } from "@/components/ui/HeroMark";
import { Modal, ModalActions } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";
import { useActionStateToast } from "@/components/ui/ActionErrorNotice";
import { sendPasswordReset } from "@/lib/settings/actions";
import type { ActionState } from "@/lib/errors";

const INITIAL: ActionState = {};

/**
 * The one place a password is set from settings, and it is ONLY ever by
 * emailed link.
 *
 * NO FIELD FOR THE CURRENT PASSWORD, ANYWHERE HERE. Settings used to offer a
 * "change" form that asked for it, and a browser or password manager would
 * fill that field the moment the dialog opened, one eye-toggle away from being
 * shown to whoever was at the screen. The current password is never displayed,
 * never fetched and never typed in this dialog: a new one is set by opening a
 * link sent to the account's OWN address (read from the session server-side;
 * the form has no email field on purpose, so there is nothing to point at
 * somebody else's inbox). Setting it through that link signs out every other
 * device, and with two-factor on the link asks for a code as well
 * (lib/auth/actions.ts resetPassword).
 *
 * An account with no password (an OAuth signup) gets the same link, which is
 * the only way it can get one.
 */
export function PasswordModal({
  open,
  onClose,
  hasPassword,
  email,
}: {
  open: boolean;
  onClose: () => void;
  /** Resolved server-side from the password hash, not from `identities`. */
  hasPassword: boolean;
  email: string;
}) {
  const t = useTranslations("Settings.account.password");

  return (
    <Modal
      open={open}
      onClose={onClose}
      // What this dialog does is send one email.
      visual={<HeroMark icon={Mail} />}
      title={hasPassword ? t("modalTitleReset") : t("modalTitleSet")}
      description={t("modalDescriptionReset", { email })}
    >
      <ResetView hasPassword={hasPassword} onClose={onClose} />
    </Modal>
  );
}

/**
 * How long the button stays shut after a link goes out.
 *
 * This is a UX guard, not the rate limit: the real budgets are server-side and
 * unbypassable (5/hour per user AND 5/hour per client in `sendPasswordReset`).
 * What this stops is someone clicking four times in ten seconds because the
 * mail has not landed yet, spending an hour's allowance on one impatient
 * minute and getting an error instead of an inbox.
 */
const RESEND_COOLDOWN_SECONDS = 60;
/** Survives the modal being closed and reopened, and a page reload with it;
 *  a cooldown you can skip by pressing Escape is not a cooldown. */
const LAST_SENT_KEY = "sq:password-reset-sent-at";

function readCooldown(): number {
  if (typeof window === "undefined") return 0;
  try {
    const at = Number(sessionStorage.getItem(LAST_SENT_KEY));
    if (!at) return 0;
    const left = RESEND_COOLDOWN_SECONDS - Math.floor((Date.now() - at) / 1000);
    return Math.max(0, left);
  } catch {
    return 0; // Storage can be disabled; the server limit still holds.
  }
}

function ResetView({
  hasPassword,
  onClose,
}: {
  hasPassword: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Settings.account.password");
  const tCommon = useTranslations("Common.actions");
  const [state, formAction, isPending] = useActionState(
    sendPasswordReset,
    INITIAL,
  );
  useActionStateToast(state);
  // Seeded from storage at mount, so reopening the modal picks the countdown
  // up where it left off. Safe to read during render here: the modal returns
  // null while closed, so this view only ever renders in the browser.
  const [cooldown, setCooldown] = React.useState(readCooldown);
  const [sent, setSent] = React.useState(cooldown > 0);

  // Start the clock when a submission FINISHES successfully. Watching
  // `state.success` alone would not do: a resend returns the same string, so
  // the value never changes and the effect would not fire a second time.
  const wasPending = React.useRef(false);
  React.useEffect(() => {
    if (wasPending.current && !isPending && state.success) {
      try {
        sessionStorage.setItem(LAST_SENT_KEY, String(Date.now()));
      } catch {
        // Non-fatal: the countdown just will not survive a reload.
      }
      setSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
    wasPending.current = isPending;
  }, [isPending, state.success]);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const waiting = cooldown > 0;
  const label = isPending
    ? tCommon("sending")
    : waiting
      ? t("resendIn", { seconds: cooldown })
      : sent
        ? t("resendEmail")
        : t("emailMeALink");

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* What the link will do matters once it is opened, not before the
          button is pressed: one line that opens, for whoever wants it now. */}
      <Disclosure summary={t("whatHappens")} className={helpTextClass}>
        <p>{hasPassword ? t("neverShownNote") : t("googleAccountNote")}</p>
      </Disclosure>

      <ModalActions>
        <Button type="button" variant="ghost" onClick={onClose}>
          {tCommon("cancel")}
        </Button>
        <Button
          type="submit"
          disabled={isPending || waiting}
          suppressHydrationWarning
        >
          {isPending && <Spinner />}
          {label}
        </Button>
      </ModalActions>
    </form>
  );
}
