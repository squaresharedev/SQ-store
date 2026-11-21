"use client";

import { ShoppingBag, ShoppingBasket, ShoppingCart, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { cartPageUrl } from "@/lib/storefront/product-page-url";
import { readableOn } from "@/components/product-page/product-page-maps";
import { useCart } from "./CartContext";
import type { CartIconName } from "./cart-look";

/** The cart look's icon names, drawn. */
export const CART_ICON: Record<CartIconName, LucideIcon> = {
  bag: ShoppingBag,
  cart: ShoppingCart,
  basket: ShoppingBasket,
};

/**
 * THE CART BUTTON: the cart's icon and how much is in it, in the page's own
 * ink (it sits in the page's header or the shop's masthead). Opens the cart
 * panel; inside the embedded shop it is a link to the cart on our page, in a
 * new tab, carrying the cart's id. Renders nothing where the page has no
 * cart.
 */
export function CartButton({ ink, className }: { ink: string; className?: string }) {
  const t = useTranslations("ProductPage.cart");
  const cart = useCart();
  if (!cart) return null;
  const { look, count, lastAdded } = cart;
  const Icon = CART_ICON[look.icon];
  // Inside the embedded shop the frame may hold no cart of its own while the
  // buyer's cart lives on our page (filled from product pages opened in new
  // tabs), so it never says "empty": it offers the cart.
  const label = cart.embedded && count === 0 ? t("view") : t("button", { count });
  const body = (
    <>
      <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
      {count > 0 && (
        <span
          // Keyed on the last add, so the bump plays once per add.
          key={look.bump ? (lastAdded?.at ?? 0) : 0}
          aria-hidden="true"
          className={cn(
            "absolute -right-0.5 -top-0.5 flex items-center justify-center rounded-full text-2xs font-semibold leading-none tabular-nums",
            look.count === "number" ? "h-4 min-w-4 px-1" : "size-2",
            look.bump && lastAdded && "motion-safe:animate-check-pop",
          )}
          style={{ backgroundColor: ink, color: readableOn(ink) }}
          data-cart-count={count}
        >
          {look.count === "number" ? (count > 99 ? "99+" : count) : null}
        </span>
      )}
    </>
  );
  const shared = cn(
    "relative inline-flex size-10 items-center justify-center transition-opacity duration-base ease-standard hover:opacity-70",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
    className,
  );

  if (cart.embedded) {
    return (
      <a
        href={cartPageUrl(cart.storefrontId, cart.cartId)}
        target="_blank"
        rel="noopener"
        aria-label={label}
        className={shared}
        style={{ color: ink, outlineColor: ink }}
        data-cart-button=""
      >
        {body}
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => cart.setOpen(true)}
      aria-label={label}
      aria-haspopup="dialog"
      className={shared}
      style={{ color: ink, outlineColor: ink }}
      data-cart-button=""
    >
      {body}
    </button>
  );
}
