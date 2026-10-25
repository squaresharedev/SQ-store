"use client";

import { useEffect, useState } from "react";
import { CancelPlanDialog } from "@/components/billing/CancelPlanDialog";
import { PlanPricesProvider } from "@/components/billing/plan-context";
import { ConnectStripeModal } from "@/components/payments/ConnectStripeModal";
import { PayoutDetailModal } from "@/components/payments/PayoutDetailModal";
import { TransactionDetailModal } from "@/components/payments/TransactionDetailModal";
import { PLAN_PRICE_SEED } from "@/lib/billing/pricing-seed";
import type { BalanceTransaction, Payout, PayoutMethod } from "@/lib/payments/types";
import { inAMonth, STAND_IN_DELAY_MS, wait } from "../../pricing/fixtures";
import type { Specimen } from "./types";

/** A pretend cancel: waits like the server, then answers yes. */
function CancelPlan({ onClose, done = false }: { onClose: () => void; done?: boolean }) {
  const [periodEnd] = useState(inAMonth);
  // The "done" specimen presses Cancel plan itself once the dialog is up, so
  // the end state can be linked to.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(
      () => document.querySelector<HTMLButtonElement>("[data-cancel-confirm]")?.click(),
      150,
    );
    return () => clearTimeout(timer);
  }, [done]);
  return (
    // The dialog lists what the plan adds over Free, fee included, so it
    // needs the prices its page would provide.
    <PlanPricesProvider prices={PLAN_PRICE_SEED}>
      <CancelPlanDialog
        open
        onClose={onClose}
        plan="starter"
        periodEnd={periodEnd}
        actions={{
          cancelPlan: async () => {
            await wait(done ? 0 : STAND_IN_DELAY_MS);
            return { ok: true, endsAt: periodEnd };
          },
          resumePlan: async () => {
            await wait(STAND_IN_DELAY_MS);
            return { ok: true };
          },
        }}
      />
    </PlanPricesProvider>
  );
}

const METHOD: PayoutMethod = {
  id: "ba_dev",
  type: "bank_account",
  bankName: "Erste Bank",
  last4: "4821",
  currency: "EUR",
  country: "AT",
  isDefault: true,
};

const PAYOUT: Payout = {
  id: "po_dev_1NxQ2e",
  amountCents: 48250,
  currency: "EUR",
  status: "paid",
  arrivalDate: "2026-10-02",
  createdAt: "2026-09-30T09:12:00Z",
  method: "standard",
  destinationLast4: "4821",
  automatic: true,
  statementDescriptor: "SQUARESHARE",
};

const TRANSACTION: BalanceTransaction = {
  id: "txn_dev_3KpL9a",
  type: "charge",
  amountCents: 3400,
  feeCents: 129,
  netCents: 3271,
  currency: "EUR",
  description: "Field camera strap",
  createdAt: "2026-10-01T14:03:00Z",
  status: "available",
};

export const BILLING: readonly Specimen[] = [
  {
    id: "cancel-plan",
    group: "Billing",
    label: "Cancel plan",
    kind: "dialog",
    render: ({ onClose }) => <CancelPlan onClose={onClose} />,
  },
  {
    id: "cancel-plan-done",
    group: "Billing",
    label: "Cancel plan (done)",
    kind: "dialog",
    render: ({ onClose }) => <CancelPlan onClose={onClose} done />,
  },
  {
    id: "payments-connect",
    group: "Payments",
    label: "Connect with Stripe",
    kind: "dialog",
    render: ({ onClose }) => <ConnectStripeModal open onClose={onClose} />,
  },
  {
    id: "payments-payout",
    group: "Payments",
    label: "Payout",
    kind: "dialog",
    render: ({ onClose }) => <PayoutDetailModal open onClose={onClose} payout={PAYOUT} method={METHOD} />,
  },
  ...(["in_transit", "pending", "failed", "canceled"] as const).map(
    (status): Specimen => ({
      id: `payments-payout-${status.replace("_", "-")}`,
      group: "Payments",
      label: `Payout (${status.replace("_", " ")})`,
      kind: "dialog",
      render: ({ onClose }) => (
        <PayoutDetailModal open onClose={onClose} payout={{ ...PAYOUT, status }} method={METHOD} />
      ),
    }),
  ),
  {
    id: "payments-transaction",
    group: "Payments",
    label: "Transaction",
    kind: "dialog",
    render: ({ onClose }) => <TransactionDetailModal open onClose={onClose} transaction={TRANSACTION} />,
  },
];
