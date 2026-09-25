"use client";

import { useTranslations, useLocale } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { formatOrderDateTime } from "@/lib/format/date";
import type { BalanceTransaction } from "@/lib/payments/types";
import { DetailRow } from "./DetailRow";

/** Read-only detail view for one balance transaction (Stripe shape). */
export function TransactionDetailModal({
  open,
  onClose,
  transaction,
}: {
  open: boolean;
  onClose: () => void;
  transaction: BalanceTransaction;
}) {
  const t = useTranslations("Payments.transactionModal");
  const locale = useLocale();
  const negative = transaction.amountCents < 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("title", { type: transaction.type })}
      description={transaction.description}
    >
      <p
        className={cn(
          "text-3xl font-bold",
          negative ? "text-foreground" : "text-success",
        )}
      >
        {negative ? "" : "+"}
        {formatCents(transaction.amountCents, transaction.currency, locale)}
      </p>

      <div className="mt-6 space-y-4">
        {transaction.feeCents > 0 && (
          <>
            <DetailRow label={t("processingFee")}>
              <span className="text-sm text-foreground">
                {formatCents(transaction.feeCents, transaction.currency, locale)}
              </span>
            </DetailRow>
            <DetailRow label={t("net")}>
              <span className="text-sm text-foreground">
                {formatCents(transaction.netCents, transaction.currency, locale)}
              </span>
            </DetailRow>
          </>
        )}
        <DetailRow label={t("status")}>
          <span className="text-sm text-foreground">
            {transaction.status === "pending" ? t("statusPending") : t("statusAvailable")}
          </span>
        </DetailRow>
        <DetailRow label={t("date")}>
          <span className="text-sm text-foreground">
            {formatOrderDateTime(transaction.createdAt, locale)}
          </span>
        </DetailRow>
        <DetailRow label={t("id")}>
          <span className="break-all font-mono text-xs text-muted-foreground">
            {transaction.id}
          </span>
        </DetailRow>
      </div>
    </Modal>
  );
}
