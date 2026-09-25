"use client";

import { ArrowUpRight, Landmark, ShieldCheck, Timer } from "lucide-react";
import { useTranslations } from "next-intl";
import { iconTileClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
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
      title={t("connectModal.title")}
      description={t("connectModal.description")}
    >
      <CardSwipe className="mb-5" />

      <ul className="space-y-4">
        {POINTS.map((point) => (
          <li key={point.copy} className="flex gap-3">
            <span className={cn(iconTileClass, "size-9")}>
              <point.icon className="size-4" strokeWidth={2} aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">
                {t(`connectModal.points.${point.copy}.title`)}
              </p>
              <p className="mt-0.5 font-inter text-sm text-muted-foreground">
                {t(`connectModal.points.${point.copy}.body`)}
              </p>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
      </div>
    </Modal>
  );
}
