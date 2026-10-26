"use client";

import { ArrowUpRight, Landmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { infoTextClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";
import { cardClass, iconTileClass } from "@/components/ui/surface-styles";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import { openStripeDashboard } from "@/lib/payments/connect/actions";
import type { PayoutMethod } from "@/lib/payments/types";
import { useLeaveForStripe } from "./useLeaveForStripe";

/**
 * Where payouts land. Displays MASKED info only (bank name + last4). "Manage
 * in Stripe" goes straight to the seller's Stripe dashboard: bank details are
 * changed there, never here.
 */
export function PayoutMethodCard({
  method,
  manage = openStripeDashboard,
}: {
  method: PayoutMethod | null;
  /** The server call that answers with the dashboard link. Injectable for the
   *  dev gallery, like ConnectStripeModal's `start`. */
  manage?: typeof openStripeDashboard;
}) {
  const t = useTranslations("Payments.payoutMethod");
  const [open, leaving] = useLeaveForStripe(manage);
  return (
    <section
      aria-label={t("title")}
      className={cn(cardClass, "p-4")}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">{t("title")}</h2>
        {method && (
          <Button variant="secondary" onClick={open} disabled={leaving} aria-busy={leaving || undefined}>
            {leaving && <Spinner />}
            {t("manage")}
            <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden />
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
              {t(method.isDefault ? "detailDefault" : "detail", {
                currency: method.currency,
                country: method.country,
              })}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 font-inter text-sm text-muted-foreground">
          {/* "Connect Stripe" is only advice once connecting is possible. */}
          {STRIPE_CONNECT_AVAILABLE ? t("emptyConnectable") : t("empty")}
        </p>
      )}
    </section>
  );
}
