"use client";

import { ArrowUpRight, Landmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { infoTextClass, stubBadgeClass } from "@/components/ui/control-styles";
import type { PayoutMethod } from "@/lib/payments/types";
import { DetailRow } from "./DetailRow";

/**
 * READ-ONLY view of the payout method. Deliberately not an edit form: bank
 * details are changed on Stripe's hosted dashboard only, so no financial data
 * is ever entered in this app. Shows masked info (last4) exclusively.
 */
export function PayoutMethodModal({
  open,
  onClose,
  method,
}: {
  open: boolean;
  onClose: () => void;
  method: PayoutMethod;
}) {
  const t = useTranslations("Payments");
  const tCommon = useTranslations("Common.actions");
  function handleManageInStripe() {
    // TODO(stripe): call the server to create a login link for the connected
    // account (stripe.accounts.createLoginLink) and redirect to Stripe's
    // hosted Express dashboard, where the bank account is managed.
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("payoutMethodModal.title")}
      description={t("payoutMethodModal.description")}
    >
      <div className="flex items-center gap-3 rounded-md border border-border bg-muted p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-background text-foreground">
          <Landmark className="size-5" strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {method.bankName} ···· {method.last4}
          </p>
          <p className={infoTextClass}>
            {t("payoutMethodModal.bankAccountDetail", {
              currency: method.currency,
              country: method.country,
            })}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <DetailRow label={t("payoutMethodModal.defaultLabel")}>
          <span className="text-sm text-foreground">
            {method.isDefault ? t("payoutMethodModal.yes") : t("payoutMethodModal.no")}
          </span>
        </DetailRow>
        <DetailRow label={t("payoutMethodModal.referenceLabel")}>
          <span className="break-all font-mono text-xs text-muted-foreground">
            {method.id}
          </span>
        </DetailRow>
      </div>

      <p className="mt-4 border-t border-border pt-4 font-inter text-sm text-muted-foreground">
        {t("payoutMethodModal.securityNote")}
      </p>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose}>
          {tCommon("close")}
        </Button>
        <Button onClick={handleManageInStripe}>
          {t("payoutMethodModal.manageInStripe")}
          <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden />
          <span className={stubBadgeClass}>{t("soon")}</span>
        </Button>
      </div>
    </Modal>
  );
}
