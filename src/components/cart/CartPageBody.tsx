"use client";

import { useTranslations } from "next-intl";
import { useCart } from "./CartContext";
import { CartContents, CartSummary, type CartPanelTheme } from "./CartPanel";

/**
 * The cart as a page of its own (/s/[storefrontId]/cart): where the embedded
 * shop sends a buyer, where a checkout with a problem line sends them back to,
 * and the cart without a panel. The same contents and summary as the panel.
 */
export function CartPageBody({ theme, shopHref }: { theme: CartPanelTheme; shopHref: string }) {
  const t = useTranslations("ProductPage.cart");
  const cart = useCart();
  if (!cart) return null;
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 @md:px-6 @3xl:py-12" data-cart-page="">
      <h1 className="text-2xl font-semibold leading-tight @md:text-3xl">{cart.config.title ?? t("title")}</h1>
      <CartContents theme={theme} onShop={() => window.location.assign(shopHref)} />
      <CartSummary theme={theme} />
      {cart.view && cart.view.lines.length > 0 && (
        <a href={shopHref} className="self-center text-sm font-medium underline underline-offset-4">
          {t("keepShopping")}
        </a>
      )}
    </div>
  );
}
