"use client";

import { ArrowUpRight, Landmark, ShieldCheck, Timer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Disclosure } from "@/components/ui/Disclosure";
import { Modal, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { stubBadgeClass } from "@/components/ui/control-styles";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import { CardSwipe } from "./CardSwipe";

/** Each point's icon, and where its copy lives under Payments.connectModal.points. */
const POINTS = [
  { icon: ShieldCheck, copy: "sensitive" },
  { icon: Landmark, copy: "bank" },
  { icon: Timer, copy: "time" },
] as const;

/**
 * Explains the Stripe Connect flow before redirecting. The CTA is a stub:
 * connecting NEVER happens in-app, it is a redirect to Stripe's hosted
 * onboarding.
 *
 * The card going through the reader says what this is. Under it, three
 * reassurances as one line each, their detail one tap away for whoever wants
 * it before leaving for Stripe.
 */
export function ConnectStripeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Payments");
  // TODO(stripe): when Connect ships, this becomes a server call that creates
  // an Account Link (stripe.accountLinks.create, type "account_onboarding")
  // and redirects to the returned Stripe-hosted URL. No financial data is
  // ever collected in-app. Until then the CTA is DISABLED: a clickable button
  // that does nothing reads as broken, not as "coming soon". The switch is the
  // app-wide one (lib/payments/availability.ts), so the dashboard stops asking
  // for a connection on the same day this button starts making one.

  return (
    <Modal
      open={open}
      onClose={onClose}
      visual={<CardSwipe className="w-full" />}
      title={t("connectModal.title")}
      description={t("connectModal.description")}
    >
      <ul className="flex flex-col gap-3 font-inter text-sm text-foreground">
        {POINTS.map((point) => (
          <li key={point.copy}>
            <Disclosure
              icon={point.icon}
              summary={
                <span className="font-medium">{t(`connectModal.points.${point.copy}.title`)}</span>
              }
            >
              <p className="text-muted-foreground">{t(`connectModal.points.${point.copy}.body`)}</p>
            </Disclosure>
          </li>
        ))}
      </ul>

      <ModalActions className="mt-6">
        <Button variant="ghost" onClick={onClose}>
          {t("connectModal.notNow")}
        </Button>
        <Button
          disabled={!STRIPE_CONNECT_AVAILABLE}
          title={STRIPE_CONNECT_AVAILABLE ? undefined : t("connectModal.comingSoonTitle")}
        >
          {t("connectModal.continue")}
          <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden />
          {!STRIPE_CONNECT_AVAILABLE && <span className={stubBadgeClass}>{t("soon")}</span>}
        </Button>
      </ModalActions>
    </Modal>
  );
}
