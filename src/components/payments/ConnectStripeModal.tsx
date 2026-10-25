"use client";

import { ArrowUpRight, Landmark, ShieldCheck, Timer } from "lucide-react";
import { useTranslations } from "next-intl";
import { Disclosure } from "@/components/ui/Disclosure";
import { Modal, ModalActions } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { stubBadgeClass } from "@/components/ui/control-styles";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import { startStripeOnboarding, type ConnectStripeResult } from "@/lib/payments/connect/actions";
import { CardSwipe } from "./CardSwipe";
import { useLeaveForStripe } from "./useLeaveForStripe";

/** Each point's icon, and where its copy lives under Payments.connectModal.points. */
const POINTS = [
  { icon: ShieldCheck, copy: "sensitive" },
  { icon: Landmark, copy: "bank" },
  { icon: Timer, copy: "time" },
] as const;

/**
 * Explains the Stripe Connect flow before leaving for it. Connecting NEVER
 * happens in-app: the button asks the server for a link into Stripe's hosted
 * onboarding (lib/payments/connect/actions.ts) and the browser goes there.
 *
 * The card going through the reader says what this is. Under it, three
 * reassurances as one line each, their detail one tap away for whoever wants
 * it before leaving for Stripe.
 */
export function ConnectStripeModal({
  open,
  onClose,
  start = startStripeOnboarding,
}: {
  open: boolean;
  onClose: () => void;
  /** The server call that answers with Stripe's onboarding link. Injectable,
   *  so the dev gallery can show the dialog without a session or Stripe. */
  start?: () => Promise<ConnectStripeResult>;
}) {
  const t = useTranslations("Payments");
  // While Connect is switched off (lib/payments/availability.ts) the CTA is
  // DISABLED: a clickable button that does nothing reads as broken, not as
  // "coming soon". The switch is the app-wide one, so the dashboard starts
  // asking for a connection on the same day this button starts making one.
  const [connect, leaving] = useLeaveForStripe(start);

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
          onClick={connect}
          disabled={!STRIPE_CONNECT_AVAILABLE || leaving}
          aria-busy={leaving || undefined}
          title={STRIPE_CONNECT_AVAILABLE ? undefined : t("connectModal.comingSoonTitle")}
          data-connect-stripe=""
        >
          {leaving && <Spinner />}
          {t("connectModal.continue")}
          <ArrowUpRight className="size-4" strokeWidth={2} aria-hidden />
          {!STRIPE_CONNECT_AVAILABLE && <span className={stubBadgeClass}>{t("soon")}</span>}
        </Button>
      </ModalActions>
    </Modal>
  );
}
