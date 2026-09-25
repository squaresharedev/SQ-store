"use client";

import { useTranslations, useLocale } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { formatCents } from "@/lib/format/money";
import { formatOrderDate, formatOrderDateTime } from "@/lib/format/date";
import type { Payout } from "@/lib/payments/types";
import { DetailRow } from "./DetailRow";
import { PayoutStatusBadge } from "./PayoutStatusBadge";

/** Read-only detail view for one payout. Masked destination (last4) only. */
export function PayoutDetailModal({
  open,
  onClose,
  payout,
}: {
  open: boolean;
  onClose: () => void;
  payout: Payout;
}) {
  const t = useTranslations("Payments.payoutModal");
  const locale = useLocale();
  return (
    <Modal open={open} onClose={onClose} title={t("title")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-3xl font-bold text-foreground">
          {formatCents(payout.amountCents, payout.currency, locale)}
        </p>
        <PayoutStatusBadge status={payout.status} />
      </div>

      <div className="mt-6 space-y-4">
        <DetailRow label={t("sentTo")}>
          <span className="text-sm text-foreground">
            {t("bankAccount", { last4: payout.destinationLast4 })}
          </span>
        </DetailRow>
        <DetailRow label={t("arrives")}>
          <span className="text-sm text-foreground">
            {formatOrderDate(payout.arrivalDate, locale)}
          </span>
        </DetailRow>
        <DetailRow label={t("initiated")}>
          <span className="text-sm text-foreground">
            {formatOrderDateTime(payout.createdAt, locale)}
          </span>
        </DetailRow>
        <DetailRow label={t("type")}>
          <span className="text-sm text-foreground">
            {t("typeValue", {
              method: payout.method,
              automatic: payout.automatic ? "true" : "false",
            })}
          </span>
        </DetailRow>
        {payout.statementDescriptor && (
          <DetailRow label={t("statement")}>
            <span className="text-sm text-foreground">
              {payout.statementDescriptor}
            </span>
          </DetailRow>
        )}
        <DetailRow label={t("id")}>
          <span className="break-all font-mono text-xs text-muted-foreground">
            {payout.id}
          </span>
        </DetailRow>
      </div>

      {payout.status === "failed" && (
        <p className="mt-4 border-t border-border pt-4 font-inter text-sm text-danger-strong">
          {t("failed")}
        </p>
      )}
    </Modal>
  );
}
