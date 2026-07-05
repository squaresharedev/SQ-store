"use client";

import { ArrowUpRight, BadgeCheck, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AccountStatus } from "@/lib/payments/types";

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
  if (!account.connected) {
    return (
      <section
        aria-label="Stripe connection"
        className="rounded-md border border-border bg-card p-6 shadow-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-secondary text-foreground">
              <CreditCard className="size-5" strokeWidth={2} aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold text-foreground">
                Connect Stripe to get paid
              </h2>
              <p className="mt-1 max-w-md font-inter text-sm text-muted-foreground">
                Payouts go straight to your bank. Setup happens securely on
                Stripe, we never see or store your bank details.
              </p>
            </div>
          </div>
          <Button onClick={onConnect}>
            Connect with Stripe
            <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden />
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Stripe connection"
      className="rounded-md border border-border bg-card p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BadgeCheck className="size-5 shrink-0 text-success" strokeWidth={2} aria-hidden />
          <div>
            <p className="text-sm font-medium text-foreground">
              Stripe account connected
            </p>
            {account.accountId && (
              <p className="font-mono text-xs text-muted-foreground">
                {account.accountId}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <StatusDot ok={account.chargesEnabled} label="Charges" />
          <StatusDot ok={account.payoutsEnabled} label="Payouts" />
          <StatusDot ok={account.detailsSubmitted} label="Verified" />
        </div>
      </div>
      {account.requirementsDue.length > 0 && (
        <p className="mt-3 border-t border-border pt-3 font-inter text-sm text-destructive">
          Stripe needs more information before payouts can continue.
        </p>
      )}
    </section>
  );
}
