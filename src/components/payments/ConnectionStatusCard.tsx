"use client";

import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { cardClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { stubBadgeClass } from "@/components/ui/control-styles";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import type { AccountStatus } from "@/lib/payments/types";
import { CardSwipe } from "./CardSwipe";

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 font-inter text-xs text-muted-foreground">
      <span
        aria-hidden
        className={
          ok ? "size-1.5 rounded-full bg-success" : "size-1.5 rounded-full bg-border"
        }
      />
      {label}
    </span>
  );
}

/**
 * Connection state for the seller's Stripe account. Not-connected renders the
 * onboarding CTA; connected renders a verified summary. Both CTAs only open
 * the info modal / stub — the actual connect flow is a redirect to STRIPE'S
 * hosted onboarding (never an in-app form).
 */
export function ConnectionStatusCard({
  account,
  onConnect,
}: {
  account: AccountStatus;
  onConnect: () => void;
}) {
  const t = useTranslations("Payments");
  // Until Stripe Connect ships, a "Connect with Stripe" button only opens a
  // modal whose continue button is disabled. Say what is true instead, and how
  // buyers pay in the meantime (lib/payments/availability.ts).
  if (!account.connected && !STRIPE_CONNECT_AVAILABLE) {
    return (
      <section
        data-tour="stripe-connection"
        aria-label={t("connection.label")}
        className={cn(cardClass, "overflow-hidden")}
      >
        <CardSwipe className="rounded-none border-x-0 border-t-0" />
        <div className="p-6">
          <h2 className="flex flex-wrap items-center text-base font-semibold text-foreground">
            {t("connection.comingSoonTitle")}
            <span className={stubBadgeClass}>{t("soon")}</span>
          </h2>
          <p className="mt-1 max-w-md font-inter text-sm text-muted-foreground">
            {t("connection.comingSoonBody")}
          </p>
        </div>
      </section>
    );
  }

  if (!account.connected) {
    return (
      <section
        data-tour="stripe-connection"
        aria-label={t("connection.label")}
        className={cn(cardClass, "overflow-hidden")}
      >
        {/* Hero: a card being swiped — the "get paid" moment made tangible. */}
        <CardSwipe className="rounded-none border-x-0 border-t-0" />
        <div className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <h2 className="text-base font-semibold text-foreground">
              {t("connection.connectTitle")}
            </h2>
            <p className="mt-1 max-w-md font-inter text-sm text-muted-foreground">
              {t("connection.connectBody")}
            </p>
          </div>
          <Button onClick={onConnect}>
            {t("connection.connectButton")}
            <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden />
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      data-tour="stripe-connection"
      aria-label={t("connection.label")}
      className={cn(cardClass, "p-4")}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BadgeCheck className="size-5 shrink-0 text-success" strokeWidth={2} aria-hidden />
          <div>
            <p className="text-sm font-medium text-foreground">
              {t("connection.connected")}
            </p>
            {account.accountId && (
              <p className="font-mono text-xs text-muted-foreground">
                {account.accountId}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <StatusDot ok={account.chargesEnabled} label={t("connection.charges")} />
          <StatusDot ok={account.payoutsEnabled} label={t("connection.payouts")} />
          <StatusDot ok={account.detailsSubmitted} label={t("connection.verified")} />
        </div>
      </div>
      {account.requirementsDue.length > 0 && (
        <p className="mt-3 border-t border-border pt-3 font-inter text-sm text-danger-strong">
          {t("connection.requirementsDue")}
        </p>
      )}
    </section>
  );
}
