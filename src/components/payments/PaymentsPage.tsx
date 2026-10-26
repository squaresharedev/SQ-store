"use client";

import { useState } from "react";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";
import type {
  BalanceTransaction,
  MoneyAmount,
  PaymentsOverview,
  Payout,
} from "@/lib/payments/types";
import { BalanceSummary } from "./BalanceSummary";
import { ConnectStripeModal } from "./ConnectStripeModal";
import { PaymentsHeader } from "./PaymentsHeader";
import { PayoutDetailModal } from "./PayoutDetailModal";
import { PayoutHistory } from "./PayoutHistory";
import { PayoutMethodCard } from "./PayoutMethodCard";
import { RecentActivity } from "./RecentActivity";
import { TransactionDetailModal } from "./TransactionDetailModal";

/** Which overlay is open. Exactly one at a time. */
type ActiveModal =
  | { kind: "none" }
  | { kind: "connect" }
  | { kind: "payout"; payout: Payout }
  | { kind: "transaction"; transaction: BalanceTransaction };

/**
 * Composition for /payments, balance first. The title carries the Stripe
 * connection (a one-line chip when it is in order, the full card under it when
 * it is not). Then the balance as one card. Then what happened, activity by
 * day, as the main column, beside where the money goes: payouts and the bank.
 *
 * All data arrives as Stripe-shaped props from the mock layer (lib/payments);
 * this component only lays modules out and hosts modal state. Everything is
 * read-only display; the only actions are links into Stripe-hosted pages.
 */
export function PaymentsPage({
  overview,
  feesThisMonth,
}: {
  overview: PaymentsOverview;
  /** What the store paid Square Share this month (see BalanceSummary). */
  feesThisMonth?: MoneyAmount[] | null;
}) {
  const [modal, setModal] = useState<ActiveModal>({ kind: "none" });
  const close = () => setModal({ kind: "none" });

  return (
    <div className="relative overflow-hidden">
      <BackgroundArrow side="right" />

      <main className="relative mx-auto max-w-7xl space-y-6 px-6 py-8">
        <PaymentsHeader
          account={overview.account}
          onConnect={() => setModal({ kind: "connect" })}
        />

        <BalanceSummary
          balance={overview.balance}
          upcomingPayout={overview.upcomingPayout}
          feesThisMonth={feesThisMonth}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <RecentActivity
              transactions={overview.transactions}
              onSelect={(transaction) => setModal({ kind: "transaction", transaction })}
            />
          </div>
          <div className="space-y-4">
            <PayoutHistory
              payouts={overview.payouts}
              onSelect={(payout) => setModal({ kind: "payout", payout })}
            />
            <PayoutMethodCard method={overview.payoutMethod} />
          </div>
        </div>
      </main>

      <ConnectStripeModal open={modal.kind === "connect"} onClose={close} />
      {modal.kind === "payout" && (
        <PayoutDetailModal
          open
          onClose={close}
          payout={modal.payout}
          method={overview.payoutMethod}
        />
      )}
      {modal.kind === "transaction" && (
        <TransactionDetailModal
          open
          onClose={close}
          transaction={modal.transaction}
        />
      )}
    </div>
  );
}
