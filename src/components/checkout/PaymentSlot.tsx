import { CreditCard, FlaskConical, Lock } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { fieldBaseClass } from "@/components/ui/control-styles";
import { ruleColor, subtleFill } from "@/components/product-page/product-page-maps";
import type { CheckoutProviderId } from "@/lib/checkout/availability";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import { PAYMENTS_PATH } from "@/lib/dashboard/paths";

/** The wallets Stripe's Payment Element offers beside a card. Product names,
 *  spelled the same in every language, so constants rather than copy. */
const WALLETS = ["Apple Pay", "Google Pay"] as const;

/**
 * WHERE THE PAYMENT GOES on the checkout. One slot, three occupants:
 *
 *   - the editor (`provider` null): a still drawing of the card fields in the
 *     seller's own field style, so the design can be judged with the payment
 *     in place, and a line under it saying the drawing takes no money yet;
 *   - the development test provider: a plain notice that no money moves;
 *   - Stripe: a notice that the card is entered on Stripe's own page, which
 *     is where the Pay button leads (lib/checkout/stripe-provider.ts).
 *
 * Nothing here ever holds card data: the card is typed into Stripe's page,
 * which is what keeps a card number off our servers entirely.
 */
export function PaymentSlot({
  provider,
  ink,
  radius,
}: {
  provider: CheckoutProviderId | null;
  ink: string;
  radius: number;
}) {
  const t = useTranslations("ProductPage.checkout.payment");

  if (provider === "test") {
    return (
      <div
        className="flex items-start gap-3 px-4 py-3.5 text-sm"
        style={{ backgroundColor: subtleFill(ink), borderRadius: `${radius}px` }}
        data-checkout-payment="test"
      >
        <FlaskConical className="mt-0.5 size-4 shrink-0 opacity-70" strokeWidth={2} aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">{t("testTitle")}</p>
          <p className="opacity-75">{t("testBody")}</p>
        </div>
      </div>
    );
  }

  if (provider === "stripe") {
    return (
      <div
        className="flex items-start gap-3 px-4 py-3.5 text-sm"
        style={{ backgroundColor: subtleFill(ink), borderRadius: `${radius}px` }}
        data-checkout-payment="stripe"
      >
        <Lock className="mt-0.5 size-4 shrink-0 opacity-70" strokeWidth={2} aria-hidden="true" />
        <div className="flex flex-col gap-0.5">
          <p className="font-medium">{t("stripeTitle")}</p>
          <p className="opacity-75">{t("stripeBody")}</p>
        </div>
      </div>
    );
  }

  // The editor's drawing: the ways to pay as tabs, card chosen, the way
  // Stripe's Payment Element lays them out, then the card fields. Inert inputs
  // in the real field style, so they take the storefront's ink and corners
  // exactly as the contact fields above do. A picture of what will be there,
  // and one line under it, because a drawing this real reads as a checkout
  // that already takes money: it does not until Stripe is connected.
  const tab = (selected: boolean) => ({
    borderColor: selected ? ink : ruleColor(ink),
    boxShadow: selected ? `inset 0 0 0 1px ${ink}` : undefined,
    borderRadius: `${radius}px`,
  });
  return (
    <>
      <div className="flex flex-col gap-2.5" data-checkout-payment="preview" aria-hidden="true">
        <div className="grid grid-cols-3 gap-2" data-checkout-methods="">
          <span className="flex h-11 items-center gap-2 border px-3 text-xs font-semibold" style={tab(true)}>
            <CreditCard className="size-4 shrink-0" strokeWidth={2} />
            <span className="truncate">{t("card")}</span>
          </span>
          {WALLETS.map((wallet) => (
            <span
              key={wallet}
              className="flex h-11 items-center justify-center border px-2 text-xs font-semibold opacity-80"
              style={tab(false)}
            >
              <span className="truncate">{wallet}</span>
            </span>
          ))}
        </div>
        <div className="relative">
          <input
            className={cn(fieldBaseClass, "pr-10")}
            placeholder={t("cardNumber")}
            disabled
            tabIndex={-1}
          />
          <CreditCard
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-50"
            strokeWidth={2}
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <input className={fieldBaseClass} placeholder={t("expiry")} disabled tabIndex={-1} />
          <input className={fieldBaseClass} placeholder={t("cvc")} disabled tabIndex={-1} />
        </div>
      </div>
      {/* Worded to stay true for a seller who has connected (the editor never
          knows): what buyers get while payments are off, or where they are
          switched on. A new tab and out of the page's click-to-edit, like the
          legal links, so unsaved design work stays put. */}
      <p className="text-xs opacity-70" data-checkout-payment-note="">
        {STRIPE_CONNECT_AVAILABLE
          ? t.rich("previewConnect", {
              link: (chunks) => (
                <a
                  href={PAYMENTS_PATH}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                  data-setting-skip=""
                >
                  {chunks}
                </a>
              ),
            })
          : t("previewComingSoon")}
      </p>
    </>
  );
}
