"use client";

import { useState } from "react";
import { PaymentsPage } from "@/components/payments/PaymentsPage";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import type { MoneyAmount, PaymentsOverview } from "@/lib/payments/types";
import {
  PAYMENTS_SCENARIOS,
  PAYMENTS_SCENARIO_NOTES,
  type PaymentsScenario,
} from "@/lib/payments/scenarios";

/** What a selling store is shown as having paid Square Share this month. */
const GALLERY_FEES_THIS_MONTH: MoneyAmount[] = [{ amountCents: 4310, currency: "EUR" }];

/**
 * Switch between the simulated stories and see the real Payments tab render
 * each. The `key` remounts the page per story so an open modal never carries
 * over to data it does not belong to.
 */
export function PaymentsGallery({
  overviews,
}: {
  overviews: Record<PaymentsScenario, PaymentsOverview>;
}) {
  const [scenario, setScenario] = useState<PaymentsScenario>("healthy");
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl space-y-2 px-6 pt-6">
        <SegmentedControl
          ariaLabel="Scenario"
          value={scenario}
          onChange={setScenario}
          options={PAYMENTS_SCENARIOS.map((value) => ({ value, label: value }))}
        />
        <p data-testid="scenario-note" className="font-inter text-xs text-muted-foreground">
          {PAYMENTS_SCENARIO_NOTES[scenario]}
        </p>
      </div>
      <PaymentsPage
        key={scenario}
        overview={overviews[scenario]}
        // The month's fees come from our own ledger, not from the scenario's
        // Stripe figures: a pretend total where the store has sold something,
        // the zero state where it has not.
        feesThisMonth={overviews[scenario].transactions.length > 0 ? GALLERY_FEES_THIS_MONTH : []}
      />
    </div>
  );
}
