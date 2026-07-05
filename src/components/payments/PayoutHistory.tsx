"use client";

import { formatCents } from "@/lib/format/money";
import { formatOrderDate } from "@/lib/format/date";
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
  return (
    <section
      aria-label="Payout history"
      className="rounded-md border border-border bg-card shadow-xs"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold text-foreground">Payouts</h2>
      </div>

      {payouts.length === 0 ? (
        <p className="px-4 py-8 text-center font-inter text-sm text-muted-foreground">
          No payouts yet. Once you make sales, Stripe sends your balance to your
          bank automatically.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className={HEADER_CELL}>Amount</th>
                <th className={HEADER_CELL}>Status</th>
                <th className={`hidden sm:table-cell ${HEADER_CELL}`}>Bank</th>
                <th className={HEADER_CELL}>Arrives</th>
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
                  aria-label={`Payout ${formatCents(payout.amountCents, payout.currency)}, view details`}
                  className="cursor-pointer border-b border-border last:border-b-0 transition-colors duration-180 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                >
                  <td className="whitespace-nowrap px-3 py-2.5 text-sm font-medium text-foreground">
                    {formatCents(payout.amountCents, payout.currency)}
                  </td>
                  <td className="px-3 py-2.5">
                    <PayoutStatusBadge status={payout.status} />
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2.5 font-inter text-sm text-muted-foreground sm:table-cell">
                    ···· {payout.destinationLast4}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 font-inter text-sm text-muted-foreground">
                    {formatOrderDate(payout.arrivalDate)}
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
