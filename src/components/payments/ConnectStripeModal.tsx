"use client";

import { ArrowUpRight, Landmark, ShieldCheck, Timer } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { stubBadgeClass } from "@/components/ui/control-styles";

const POINTS = [
  {
    icon: ShieldCheck,
    title: "Stripe handles the sensitive part",
    body: "Bank details, identity checks and verification all happen on Stripe's secure pages. Square Share never sees or stores them.",
  },
  {
    icon: Landmark,
    title: "Payouts go straight to your bank",
    body: "Once connected, your balance is paid out automatically on a rolling schedule.",
  },
  {
    icon: Timer,
    title: "Takes about 5 minutes",
    body: "You'll be redirected to Stripe to finish setup, then land right back here.",
  },
];

/**
 * Explains the Stripe Connect flow before redirecting. The CTA is a stub:
 * connecting NEVER happens in-app, it is a redirect to Stripe's hosted
 * onboarding.
 */
export function ConnectStripeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  function handleConnect() {
    // TODO(stripe): call the server to create an Account Link
    // (stripe.accountLinks.create with type "account_onboarding") and redirect
    // the browser to the returned Stripe-hosted URL. No financial data is ever
    // collected in-app.
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Connect with Stripe"
      description="Get paid for what you sell. Setup happens on Stripe, not here."
    >
      <ul className="space-y-4">
        {POINTS.map((point) => (
          <li key={point.title} className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-secondary text-foreground">
              <point.icon className="size-4" strokeWidth={2} aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">{point.title}</p>
              <p className="mt-0.5 font-inter text-sm text-muted-foreground">
                {point.body}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onClose}>
          Not now
        </Button>
        <Button onClick={handleConnect}>
          Continue to Stripe
          <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden />
          <span className={stubBadgeClass}>Soon</span>
        </Button>
      </div>
    </Modal>
  );
}
