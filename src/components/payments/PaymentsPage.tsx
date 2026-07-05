"use client";

import { useState } from "react";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";
import type {
  BalanceTransaction,
  PaymentsOverview,
  Payout,
} from "@/lib/payments/types";
import { BalanceSummary } from "./BalanceSummary";
import { ConnectionStatusCard } from "./ConnectionStatusCard";
import { ConnectStripeModal } from "./ConnectStripeModal";
import { PayoutDetailModal } from "./PayoutDetailModal";
import { PayoutHistory } from "./PayoutHistory";
import { PayoutMethodCard } from "./PayoutMethodCard";
import { PayoutMethodModal } from "./PayoutMethodModal";
import { RecentActivity } from "./RecentActivity";
import { TransactionDetailModal } from "./TransactionDetailModal";

/** Which overlay is open. Exactly one at a time. */
type ActiveModal =
  | { kind: "none" }
  | { kind: "connect" }
  | { kind: "method" }
  | { kind: "payout"; payout: Payout }
  | { kind: "transaction"; transaction: BalanceTransaction };

/**
 * Composition for /payments. All data arrives as Stripe-shaped props from the
 * mock layer (lib/payments); this component only lays modules out and hosts
 * modal state. Everything is read-only display, the only actions are stubs
 * that will become redirects to Stripe-hosted surfaces.
 */
export function PaymentsPage({ overview }: { overview: PaymentsOverview }) {
  const [modal, setModal] = useState<ActiveModal>({ kind: "none" });
  const close = () => setModal({ kind: "none" });

  return (
    <div className="relative overflow-hidden">
      <BackgroundArrow side="right" />

      <main className="relative mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
            Payments
          </h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">
            Your balance, payouts and Stripe connection.
          </p>
        </div>

        <ConnectionStatusCard
          account={overview.account}
          onConnect={() => setModal({ kind: "connect" })}
        />

        <BalanceSummary
          balance={overview.balance}
          upcomingPayout={overview.upcomingPayout}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <PayoutHistory
              payouts={overview.payouts}
              onSelect={(payout) => setModal({ kind: "payout", payout })}
            />
          </div>
          <div className="space-y-4">
            <PayoutMethodCard
              method={overview.payoutMethod}
              onManage={() => setModal({ kind: "method" })}
            />
            <RecentActivity
              transactions={overview.transactions}
              onSelect={(transaction) =>
                setModal({ kind: "transaction", transaction })
              }
            />
          </div>
        </div>
      </main>

      <ConnectStripeModal open={modal.kind === "connect"} onClose={close} />
      {overview.payoutMethod && (
        <PayoutMethodModal
          open={modal.kind === "method"}
          onClose={close}
          method={overview.payoutMethod}
        />
      )}
      {modal.kind === "payout" && (
        <PayoutDetailModal open onClose={close} payout={modal.payout} />
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
