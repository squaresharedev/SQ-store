"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Modal, ModalActions } from "@/components/ui/modal";
import { Spinner } from "@/components/ui/spinner";

/**
 * "ARE YOU SURE?", ONCE. Every confirmation in the product is this dialog: the
 * thing in question as its central `visual` (required, so no confirm is ever a
 * bare paragraph), a short question as the title, at most one sentence under
 * it, then Cancel and the one action.
 *
 * `tone="danger"` is for what cannot be undone: the action wears the
 * destructive button, and focus lands on the inert panel instead of a control,
 * so a habitual Enter or Space does nothing.
 *
 * Give it `onConfirm` for a client action, or `action` for a server action:
 * the body then becomes that form, `children` sit inside it (hidden inputs, a
 * step-up box), and the action button submits it.
 */

/** What draws the action button, when it is more than a button (see `submitAs`). */
export type ConfirmSubmit = React.ComponentType<{
  children: React.ReactNode;
  pending?: boolean;
  pendingLabel?: React.ReactNode;
  variant?: "primary" | "destructive";
}>;

export function ConfirmDialog({
  open,
  onClose,
  visual,
  title,
  description,
  tone = "default",
  confirmLabel,
  pendingLabel,
  cancelLabel,
  pending = false,
  confirmDisabled = false,
  onConfirm,
  action,
  submitAs: SubmitAs,
  initialFocus,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** The thing being confirmed, or a HeroMark for it. */
  visual: React.ReactNode;
  title: string;
  description?: string;
  tone?: "default" | "danger";
  confirmLabel: string;
  /** The action's words while it runs. Defaults to `confirmLabel`. */
  pendingLabel?: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  pending?: boolean;
  confirmDisabled?: boolean;
  onConfirm?: () => void;
  action?: (formData: FormData) => void;
  /**
   * Draws the action button, for a form whose submit is more than a button:
   * auth/StepUpSubmit, where confirming with a passkey IS the submit. It is
   * given the same words, tone and pending state the plain button would wear.
   */
  submitAs?: ConfirmSubmit;
  /** Where focus lands (Modal). Defaults to the inert panel for `danger`. */
  initialFocus?: "first-control" | "dialog";
  /** Between the header and the buttons: a caveat, a diff, an error, fields. */
  children?: React.ReactNode;
}) {
  const t = useTranslations("Common.actions");
  const variant = tone === "danger" ? "destructive" : "primary";
  const body = (
    <>
      {children}
      <ModalActions>
        <Button variant="ghost" onClick={onClose} disabled={pending}>
          {cancelLabel ?? t("cancel")}
        </Button>
        {SubmitAs ? (
          <SubmitAs pending={pending} pendingLabel={pendingLabel} variant={variant}>
            {confirmLabel}
          </SubmitAs>
        ) : (
          <Button
            type={action ? "submit" : "button"}
            variant={variant}
            onClick={action ? undefined : onConfirm}
            disabled={pending || confirmDisabled}
            data-confirm-action
          >
            {pending && <Spinner />}
            {pending ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </Button>
        )}
      </ModalActions>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      visual={visual}
      title={title}
      description={description}
      initialFocus={initialFocus ?? (tone === "danger" ? "dialog" : "first-control")}
    >
      {action ? (
        // noValidate: the server's own words are shown, not a native bubble.
        <form action={action} className="flex flex-col gap-4" noValidate>
          {body}
        </form>
      ) : (
        <div className="flex flex-col gap-4">{body}</div>
      )}
    </Modal>
  );
}
