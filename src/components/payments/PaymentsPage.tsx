"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "@/components/ui/AppLink";
import { BackgroundArrow } from "@/components/ui/BackgroundArrow";
import { helpTextClass, inlineLinkClass } from "@/components/ui/control-styles";
import { joinedCardsClass } from "@/components/ui/surface-styles";
import { BILLING_SETTINGS_INVOICES_PATH } from "@/lib/billing/paths";
import {
  DEFAULT_PAYMENTS_RANGE,
  isQuiet,
  rangeView,
  type PaymentsRange,
} from "@/lib/payments/history";
import type {
  BalanceTransaction,
  MoneyAmount,
  PaymentsOverview,
  Payout,
} from "@/lib/payments/types";
import { BalanceSummary } from "./BalanceSummary";
import { ConnectStripeModal } from "./ConnectStripeModal";
import { EarningsChart } from "./EarningsChart";
import { PaymentsHeader } from "./PaymentsHeader";
import { PayoutDetailModal } from "./PayoutDetailModal";
import { PayoutHistory } from "./PayoutHistory";
import { PayoutMethodCard } from "./PayoutMethodCard";
import { RecentActivity } from "./RecentActivity";
import { TrendTiles } from "./TrendTiles";
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
 * it is not). Then the balance as one card. Then how the money has been
 * coming in: earnings over a chosen period and four trend tiles for the same
 * period, joined into one block with no gap (only once a Stripe account is
 * connected; the tiles only once anything has happened). Then what happened, activity by day, as the main
 * column, beside where the money goes: payouts and the bank. Last, where the
 * invoices for the store's own plan are, since this is where a seller looks.
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
  const t = useTranslations("Payments");
  const [modal, setModal] = useState<ActiveModal>({ kind: "none" });
  const close = () => setModal({ kind: "none" });
  const [range, setRange] = useState<PaymentsRange>(DEFAULT_PAYMENTS_RANGE);
  const history = overview.history;
  const view = history ? rangeView(history, range) : null;

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

        {history && view && (
          <div className={joinedCardsClass}>
            <EarningsChart history={history} view={view} range={range} onRangeChange={setRange} />
            {!isQuiet(history.days) && <TrendTiles view={view} currency={history.currency} />}
          </div>
        )}

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

        <p className={helpTextClass}>
          {t.rich("invoicesPointer", {
            link: (chunks) => (
              <Link href={BILLING_SETTINGS_INVOICES_PATH} className={inlineLinkClass}>
                {chunks}
              </Link>
            ),
          })}
        </p>
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
