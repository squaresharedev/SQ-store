"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/components/ui/Toast";
import { useActionErrorToast } from "@/components/ui/ActionErrorNotice";
import type { BillingActions } from "@/components/billing/billing-actions";
import type { PaidPlanId } from "@/lib/billing/plans";

/**
 * "Keep my plan": undo a cancellation while the paid period is still
 * running. One click, no dialog: changing your mind back should be as easy
 * as leaving was. Shown wherever a plan is set to end (Settings › Plan &
 * billing, the plans page, the cancel dialog's own last screen). The action
 * re-checks everything.
 */
export function KeepPlanButton({
  plan,
  actions,
  onKept,
  className,
}: {
  plan: PaidPlanId;
  actions: Pick<BillingActions, "resumePlan">;
  /** Called once the plan is kept, before the page refreshes (a dialog that
   *  holds this button closes itself here). */
  onKept?: () => void;
  className?: string;
}) {
  const t = useTranslations("Billing");
  const router = useRouter();
  const toast = useToast();
  const showError = useActionErrorToast();
  const [pending, startTransition] = React.useTransition();

  function keep() {
    startTransition(async () => {
      const result = await actions.resumePlan();
      if (!result.ok) {
        showError(result.error);
        return;
      }
      toast.success(t("cancel.kept", { plan: t(`plans.${plan}.name`) }));
      onKept?.();
      router.refresh();
    });
  }

  return (
    <Button variant="secondary" className={className} onClick={keep} disabled={pending} data-keep-plan>
      {pending && <Spinner />}
      {t("cancel.keep")}
    </Button>
  );
}
