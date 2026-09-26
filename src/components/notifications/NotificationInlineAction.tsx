"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  ghostButtonClass,
  iconNudgeRightClass,
  primaryButtonClass,
} from "@/components/ui/control-styles";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/Toast";
import { useActionErrorToast, useResolveMessage } from "@/components/ui/ActionErrorNotice";
import { unexpectedError } from "@/lib/errors";
import { runNotificationAction } from "@/lib/notifications/actions";
import type {
  NotificationActionStatus,
  NotificationActionView,
} from "@/lib/notifications/inline-actions";
import { setActiveAccount } from "@/lib/team/actions";

/**
 * The in-place action on a notification row: today, a team invite's Accept.
 *
 * Only the notification's id goes to the server (runNotificationAction), which
 * works out and runs the action itself. The result is shown right here, where
 * the click landed, and in a toast; once an invite is accepted the row offers
 * the obvious next step, opening the store just joined.
 *
 * Every interactive child re-enables pointer events: the strip it sits in is
 * pointer-events-none so a click beside the button still opens the row.
 */
export function NotificationInlineAction({
  notificationId,
  action,
  onComplete,
  onNavigate,
}: {
  notificationId: string;
  action: NotificationActionView;
  onComplete?: (id: string) => void;
  onNavigate?: () => void;
}) {
  const tInvite = useTranslations("Settings.team.inviteRow");
  const t = useTranslations("Notifications.actions");
  const router = useRouter();
  const toast = useToast();
  const resolve = useResolveMessage();
  const errorToast = useActionErrorToast();
  // What the last click here settled into, if anything. Done is final from
  // either side: nothing moves a row back from done, whichever source said so.
  const [outcome, setOutcome] = React.useState<NotificationActionStatus | null>(null);
  const status: NotificationActionStatus =
    outcome === "done" || action.status === "done" ? "done" : (outcome ?? action.status);
  const [joinedStore, setJoinedStore] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const [opening, startOpening] = React.useTransition();

  function accept() {
    startTransition(async () => {
      const result = await runNotificationAction(notificationId).catch(() => null);
      if (!result) {
        errorToast(unexpectedError());
        return;
      }
      if (result.ok) {
        setOutcome("done");
        setJoinedStore(result.accountOwnerId);
        toast.success(resolve(result.message));
        onComplete?.(notificationId);
        return;
      }
      setOutcome(result.status);
      errorToast(result.error);
    });
  }

  function openStore() {
    if (!joinedStore) return;
    onNavigate?.();
    startOpening(async () => {
      const switched = await setActiveAccount(joinedStore).catch(() => null);
      if (!switched?.ok) {
        errorToast(unexpectedError());
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  if (status === "pending") {
    return (
      <button
        type="button"
        onClick={accept}
        disabled={pending}
        className={cn(primaryButtonClass, "pointer-events-auto px-3 py-1.5")}
      >
        {pending && <Spinner />}
        {pending ? tInvite("accepting") : tInvite("acceptButton")}
      </button>
    );
  }

  if (status === "done") {
    return (
      <>
        <span
          role="status"
          className="inline-flex items-center gap-1.5 font-inter text-sm font-medium text-success"
        >
          <Check aria-hidden className="size-4" strokeWidth={2.5} />
          {tInvite("accepted")}
        </span>
        {joinedStore && (
          <button
            type="button"
            onClick={openStore}
            disabled={opening}
            className={cn(ghostButtonClass, "pointer-events-auto px-2 py-1.5 text-foreground")}
          >
            {opening && <Spinner />}
            {t("openStore")}
            <ArrowRight aria-hidden className={cn("size-4", iconNudgeRightClass)} />
          </button>
        )}
      </>
    );
  }

  return <span className="font-inter text-sm text-muted-foreground">{t("unavailable")}</span>;
}
