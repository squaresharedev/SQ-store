"use client";

import { ArrowDownLeft, ArrowUpRight, ReceiptText, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { formatOrderDate } from "@/lib/format/date";
import type { BalanceTransaction, TransactionType } from "@/lib/payments/types";

const TYPE_ICONS: Record<TransactionType, typeof ArrowDownLeft> = {
  charge: ArrowDownLeft,
  refund: Undo2,
  payout: ArrowUpRight,
  stripe_fee: ReceiptText,
  adjustment: ReceiptText,
};

/**
 * The latest balance transactions (Stripe BalanceTransaction shape). Each row
 * opens the read-only transaction detail modal.
 */
export function RecentActivity({
  transactions,
  onSelect,
}: {
  transactions: BalanceTransaction[];
  onSelect: (transaction: BalanceTransaction) => void;
}) {
  return (
    <section
      aria-label="Recent activity"
      className="rounded-md border border-border bg-card shadow-xs"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">Activity</h2>
      </div>

      {transactions.length === 0 ? (
        <p className="px-4 py-8 text-center font-inter text-sm text-muted-foreground">
          Sales, refunds and payouts will show up here.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {transactions.map((transaction) => {
            const Icon = TYPE_ICONS[transaction.type] ?? ReceiptText;
            const negative = transaction.amountCents < 0;
            return (
              <li key={transaction.id}>
                <button
                  type="button"
                  onClick={() => onSelect(transaction)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-180 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-secondary text-muted-foreground">
                    <Icon className="size-4" strokeWidth={2} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {transaction.description}
                    </span>
                    <span className="block font-inter text-xs text-muted-foreground">
                      {formatOrderDate(transaction.createdAt)}
                      {transaction.status === "pending" && " · Pending"}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-medium",
                      negative ? "text-muted-foreground" : "text-success",
                    )}
                  >
                    {negative ? "" : "+"}
                    {formatCents(transaction.amountCents, transaction.currency)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
