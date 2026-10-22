"use client";

import { ArrowDownLeft, ArrowUpRight, ReceiptText, Undo2 } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { cardClass, eyebrowClass, iconTileClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { formatOrderDate } from "@/lib/format/date";
import type { Locale } from "@/i18n/locales";
import type { BalanceTransaction, TransactionType } from "@/lib/payments/types";

const TYPE_ICONS: Record<TransactionType, typeof ArrowDownLeft> = {
  charge: ArrowDownLeft,
  refund: Undo2,
  payout: ArrowUpRight,
  stripe_fee: ReceiptText,
  adjustment: ReceiptText,
};

/**
 * Newest-first rows folded into runs of one calendar day, order kept. The day
 * is the heading as the reader sees it, so a group can never split or merge
 * across the viewer's time zone.
 */
function groupByDay(
  transactions: BalanceTransaction[],
  locale: Locale,
): { day: string; rows: BalanceTransaction[] }[] {
  const groups: { day: string; rows: BalanceTransaction[] }[] = [];
  for (const transaction of transactions) {
    const day = formatOrderDate(transaction.createdAt, locale);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.rows.push(transaction);
    else groups.push({ day, rows: [transaction] });
  }
  return groups;
}

/**
 * One transaction as a row that opens its detail. Its day is the heading above
 * it, so the line under the description only says "Pending" for a sale still
 * clearing and is left out otherwise.
 */
function ActivityRow({
  transaction,
  onSelect,
}: {
  transaction: BalanceTransaction;
  onSelect: (transaction: BalanceTransaction) => void;
}) {
  const t = useTranslations("Payments");
  const locale = useLocale();
  const Icon = TYPE_ICONS[transaction.type] ?? ReceiptText;
  const negative = transaction.amountCents < 0;
  return (
    <button
      type="button"
      onClick={() => onSelect(transaction)}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-base hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
    >
      <span className={cn(iconTileClass, "size-8 text-muted-foreground")}>
        <Icon className="size-4" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">
          {transaction.description}
        </span>
        {transaction.status === "pending" && (
          <span className="block font-inter text-xs text-muted-foreground">
            {t("payoutStatus", { status: "pending" })}
          </span>
        )}
      </span>
      <span
        className={cn(
          "shrink-0 text-sm font-medium",
          negative ? "text-muted-foreground" : "text-success",
        )}
      >
        {negative ? "" : "+"}
        {formatCents(transaction.amountCents, transaction.currency, locale)}
      </span>
    </button>
  );
}

/**
 * The latest balance transactions (Stripe BalanceTransaction shape), under a
 * heading per day. Each row opens the read-only transaction detail modal.
 */
export function RecentActivity({
  transactions,
  onSelect,
}: {
  transactions: BalanceTransaction[];
  onSelect: (transaction: BalanceTransaction) => void;
}) {
  const t = useTranslations("Payments.recentActivity");
  const locale = useLocale();
  return (
    <section aria-label={t("label")} className={cardClass}>
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">{t("title")}</h2>
      </div>

      {transactions.length === 0 ? (
        <p className="px-4 py-8 text-center font-inter text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {groupByDay(transactions, locale).map(({ day, rows }) => (
            <div key={day}>
              <h3 className={cn(eyebrowClass, "bg-secondary/50 px-4 py-2")}>{day}</h3>
              <ul className="divide-y divide-border">
                {rows.map((transaction) => (
                  <li key={transaction.id}>
                    <ActivityRow transaction={transaction} onSelect={onSelect} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
