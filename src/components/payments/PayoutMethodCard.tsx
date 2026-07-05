"use client";

import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PayoutMethod } from "@/lib/payments/types";

/**
 * Where payouts land. Displays MASKED info only (bank name + last4). "Manage"
 * opens a read-only modal, editing bank details happens on Stripe's hosted
 * dashboard, never here.
 */
export function PayoutMethodCard({
  method,
  onManage,
}: {
  method: PayoutMethod | null;
  onManage: () => void;
}) {
  return (
    <section
      aria-label="Payout method"
      className="rounded-md border border-border bg-card p-4 shadow-xs"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">Payout method</h2>
        {method && (
          <Button variant="secondary" onClick={onManage}>
            Manage
          </Button>
        )}
      </div>

      {method ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-secondary text-foreground">
            <Landmark className="size-5" strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {method.bankName} ···· {method.last4}
            </p>
            <p className="font-inter text-xs text-muted-foreground">
              {method.currency} · {method.country}
              {method.isDefault && " · Default"}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 font-inter text-sm text-muted-foreground">
          No payout method yet. Connect Stripe and add your bank there, it shows
          up here automatically.
        </p>
      )}
    </section>
  );
}
