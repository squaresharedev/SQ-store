"use client";

import { useTranslations, useLocale } from "next-intl";
import { cardClass } from "@/components/ui/surface-styles";
import { formatCents } from "@/lib/format/money";
import { formatOrderDate } from "@/lib/format/date";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import type { Payout } from "@/lib/payments/types";
import { PayoutStatusBadge } from "./PayoutStatusBadge";

const HEADER_CELL =
  "py-2 px-3 text-left font-inter text-xs font-medium uppercase tracking-wide text-muted-foreground";

/**
 * Table of past payouts. Rows are keyboard-focusable (same interaction as the
 * Orders table) and open the read-only payout detail modal. Only masked
 * destination info (last4) is ever shown.
 */
export function PayoutHistory({
  payouts,
  onSelect,
}: {
  payouts: Payout[];
  onSelect: (payout: Payout) => void;
}) {
  const t = useTranslations("Payments.payoutHistory");
  const locale = useLocale();
  return (
    <section
      aria-label={t("label")}
      className={cardClass}
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">{t("title")}</h2>
      </div>

      {payouts.length === 0 ? (
        <p className="px-4 py-8 text-center font-inter text-sm text-muted-foreground">
          {/* The automatic-payout promise only once Stripe is connectable. */}
          {STRIPE_CONNECT_AVAILABLE ? t("emptyConnectable") : t("empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className={HEADER_CELL}>{t("columns.amount")}</th>
                <th className={HEADER_CELL}>{t("columns.status")}</th>
                <th className={`hidden sm:table-cell ${HEADER_CELL}`}>{t("columns.bank")}</th>
                <th className={HEADER_CELL}>{t("columns.arrives")}</th>
              </tr>
            </thead>
            <tbody>
              {payouts.map((payout) => (
                <tr
                  key={payout.id}
                  onClick={() => onSelect(payout)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(payout);
                    }
                  }}
                  tabIndex={0}
                  aria-label={t("rowLabel", {
                    amount: formatCents(payout.amountCents, payout.currency, locale),
                  })}
                  className="cursor-pointer border-b border-border last:border-b-0 transition-colors duration-base hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <td className="whitespace-nowrap px-3 py-2.5 text-sm font-medium text-foreground">
                    {formatCents(payout.amountCents, payout.currency, locale)}
                  </td>
                  <td className="px-3 py-2.5">
                    <PayoutStatusBadge status={payout.status} />
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2.5 font-inter text-sm text-muted-foreground sm:table-cell">
                    ···· {payout.destinationLast4}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-inter text-sm text-muted-foreground">
                    {formatOrderDate(payout.arrivalDate, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
