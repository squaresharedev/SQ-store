"use client";

import { Modal } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { formatOrderDateTime } from "@/lib/format/date";
import type { BalanceTransaction, TransactionType } from "@/lib/payments/types";
import { DetailRow } from "./DetailRow";

const TYPE_LABELS: Record<TransactionType, string> = {
  charge: "Sale",
  refund: "Refund",
  payout: "Payout",
  stripe_fee: "Stripe fee",
  adjustment: "Adjustment",
};

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
  const negative = transaction.amountCents < 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={TYPE_LABELS[transaction.type] ?? "Transaction"}
      description={transaction.description}
    >
      <p
        className={cn(
          "text-3xl font-bold",
          negative ? "text-foreground" : "text-success",
        )}
      >
        {negative ? "" : "+"}
        {formatCents(transaction.amountCents, transaction.currency)}
      </p>

      <div className="mt-6 space-y-4">
        {transaction.feeCents > 0 && (
          <>
            <DetailRow label="Processing fee">
              <span className="text-sm text-foreground">
                {formatCents(transaction.feeCents, transaction.currency)}
              </span>
            </DetailRow>
            <DetailRow label="Net to your balance">
              <span className="text-sm text-foreground">
                {formatCents(transaction.netCents, transaction.currency)}
              </span>
            </DetailRow>
          </>
        )}
        <DetailRow label="Status">
          <span className="text-sm text-foreground">
            {transaction.status === "pending"
              ? "Pending, clearing to your balance"
              : "Available"}
          </span>
        </DetailRow>
        <DetailRow label="Date">
          <span className="text-sm text-foreground">
            {formatOrderDateTime(transaction.createdAt)}
          </span>
        </DetailRow>
        <DetailRow label="Transaction ID">
          <span className="break-all font-mono text-xs text-muted-foreground">
            {transaction.id}
          </span>
        </DetailRow>
      </div>
    </Modal>
  );
}
