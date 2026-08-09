"use client";

import { Landmark } from "lucide-react";
import { infoTextClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { cardClass, iconTileClass } from "@/components/ui/surface-styles";
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
      className={cn(cardClass, "p-4")}
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
          <span className={cn(iconTileClass, "size-10")}>
            <Landmark className="size-5" strokeWidth={2} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {method.bankName} ···· {method.last4}
            </p>
            <p className={infoTextClass}>
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
