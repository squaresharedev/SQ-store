"use client";

import { useState } from "react";
import { Lock, Truck } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { formatCents } from "@/lib/format/money";
import { appUrl } from "@/lib/app-url";
import { cartCheckoutPath } from "@/lib/storefront/product-page-url";
import { CTA_BUTTON_CLASS, ctaStyle, type CtaAppearance } from "@/components/product-page/product-page-maps";
import { useCart } from "./CartContext";
import { CartLineRow } from "./CartLineRow";
import { CART_ICON } from "./CartButton";
import { CartSuggestions } from "./CartSuggestions";

/** What the panel's controls are painted with: the page's own. */
export type CartPanelTheme = {
  /** The panel's ink (the shop's, on the overlay surface). */
  ink: string;
  cornerRadius: number;
  /** The page's buy button: the checkout button is the same button. */
  cta: CtaAppearance;
};

/**
 * THE CART'S CONTENTS: the seller's note, every line, an Undo for the line
 * just taken out, and "Goes well with"; or an empty cart. Shared by the panel
 * and the cart page.
 */
export function CartContents({ theme, onShop }: { theme: CartPanelTheme; onShop?: () => void }) {
  const t = useTranslations("ProductPage.cart");
  const cart = useCart();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  if (!cart) return null;
  const { view, look, config } = cart;

  if (cart.status === "error" && !view) {
    return (
      <div className="flex flex-col items-start gap-3 py-6 text-sm" role="alert">
        <p>{t("busy")}</p>
        <button type="button" className="font-medium underline underline-offset-4" onClick={() => void cart.refresh()}>
          {t("retry")}
        </button>
      </div>
    );
  }

  const lines = view?.lines ?? [];
  if (lines.length === 0) {
    const Icon = CART_ICON[look.icon];
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center" data-cart-empty="">
        <Icon className="size-10 text-muted-foreground" strokeWidth={1.25} aria-hidden="true" />
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
        {onShop && (
          <button type="button" onClick={onShop} className="text-sm font-medium underline underline-offset-4">
            {t("keepShopping")}
          </button>
        )}
        {cart.undo && <UndoRow />}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {config.note && <p className="mb-2 whitespace-pre-line text-sm text-muted-foreground">{config.note}</p>}
      <ul className="flex flex-col divide-y divide-border" data-cart-lines="">
        {lines.map((line) => (
          <CartLineRow
            key={line.key}
            line={line}
            currency={view?.currency ?? "EUR"}
            rows={look.rows}
            stepper={look.stepper}
            cornerRadius={theme.cornerRadius}
            ink={theme.ink}
            busy={busyKey === line.key}
            onQuantity={async (quantity) => {
              setBusyKey(line.key);
              await cart.setQuantity(line.key, quantity);
              setBusyKey(null);
            }}
            onRemove={async () => {
              setBusyKey(line.key);
              await cart.remove(line.key);
              setBusyKey(null);
            }}
          />
        ))}
      </ul>
      {cart.undo && <UndoRow />}
      <CartSuggestions theme={theme} />
    </div>
  );
}

/** "X taken out of your cart. Undo", for a moment after a removal. */
function UndoRow() {
  const t = useTranslations("ProductPage.cart");
  const cart = useCart();
  if (!cart?.undo) return null;
  return (
    <p className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground" data-cart-undo="">
      <span>{t("removed", { title: cart.undo.line.title ?? t("gone") })}</span>
      <button type="button" onClick={() => void cart.restore()} className="font-semibold text-popover-foreground underline underline-offset-4">
        {t("undo")}
      </button>
    </p>
  );
}

/**
 * THE CART'S SUMMARY: what the items cost, delivery as far as it is known
 * before the checkout asks where, how far free delivery is, and the checkout
 * button (the page's own buy button). Delivery is shown BEFORE the checkout:
 * unexpected costs are the commonest reason a cart is abandoned.
 */
export function CartSummary({ theme }: { theme: CartPanelTheme }) {
  const t = useTranslations("ProductPage.cart");
  const locale = useLocale();
  const cart = useCart();
  if (!cart?.view || cart.view.lines.length === 0) return null;
  const { view, look, config } = cart;
  const money = (cents: number) => formatCents(cents, view.currency ?? "EUR", locale);
  const delivery = view.delivery;
  const gap = config.deliveryBar === false ? null : view.freeDeliveryGapCents;
  const over = view.freeDeliveryOverCents;
  // From the embedded shop (another origin), our own page in a new tab.
  const checkoutHref = cart.embedded
    ? appUrl(cartCheckoutPath(cart.storefrontId, view.id))
    : cartCheckoutPath(cart.storefrontId, view.id);
  // Dimmed only when the cart cannot be paid as it stands. In the editor and
  // the lab it is drawn exactly as a buyer sees it, and goes nowhere.
  const blocked = !view.canCheckout;
  const inert = blocked || cart.preview;

  return (
    <div className="flex flex-col gap-3 text-sm" data-cart-summary="">
      <dl className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-4">
          <dt>{t("subtotal")}</dt>
          <dd className="font-semibold tabular-nums" data-cart-items={view.itemsCents}>
            {money(view.itemsCents)}
          </dd>
        </div>
        {delivery.kind !== "none" && (
          <div className="flex items-baseline justify-between gap-4 text-muted-foreground" data-cart-delivery={delivery.kind}>
            <dt>{delivery.kind === "atCheckout" ? t("delivery") : t("deliveryTo", { area: delivery.area })}</dt>
            <dd className="tabular-nums">
              {delivery.kind === "free" ? t("free") : delivery.kind === "cost" ? money(delivery.cents) : t("atCheckout")}
            </dd>
          </div>
        )}
      </dl>
      {gap !== null && gap > 0 && (
        <div className="flex flex-col gap-1.5" data-cart-free-gap={gap}>
          {look.freeLine === "bar" && over !== null && (
            <div className="h-1 overflow-hidden rounded-full bg-accent" aria-hidden="true">
              <div
                className="h-full rounded-full bg-popover-foreground transition-[width] duration-slow ease-standard motion-reduce:transition-none"
                style={{ width: `${Math.min(100, Math.max(0, ((over - gap) / over) * 100))}%` }}
              />
            </div>
          )}
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Truck className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
            {t("freeGap", { amount: money(gap) })}
          </p>
        </div>
      )}
      <a
        href={inert ? undefined : checkoutHref}
        {...(cart.embedded ? { target: "_blank", rel: "noopener" } : {})}
        aria-disabled={inert}
        className={cn(
          CTA_BUTTON_CLASS,
          blocked ? "cursor-default opacity-60" : "hover:opacity-90",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        )}
        style={{ ...ctaStyle(theme.cta), outlineColor: theme.ink }}
        data-cart-checkout=""
      >
        <Lock className="size-3.5" strokeWidth={2.25} aria-hidden="true" />
        {t("checkout")}
      </a>
    </div>
  );
}
