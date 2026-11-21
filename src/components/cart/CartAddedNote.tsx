"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { cartPageUrl } from "@/lib/storefront/product-page-url";
import { useCart } from "./CartContext";

/**
 * "Added to your cart. View cart": the short note that follows "Add to cart"
 * where the cart does not open by itself (the seller chose a note, or this is
 * the embedded shop, where the cart opens on our page in a new tab). In the
 * page's own ink, under what was pressed. `onDone`: the buyer opened the cart.
 */
export function CartAddedNote({ ink, onDone, className }: { ink: string; onDone?: () => void; className?: string }) {
  const t = useTranslations("ProductPage.cart");
  const cart = useCart();
  if (!cart) return null;
  const link = "font-semibold underline underline-offset-4 focus-visible:outline focus-visible:outline-2";
  return (
    <p
      className={cn("flex flex-wrap items-center justify-center gap-x-1.5 gap-y-1 text-xs", className)}
      style={{ color: ink, outlineColor: ink }}
      data-cart-added-note=""
    >
      <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
      <span>{t("addedNote")}</span>
      {cart.embedded ? (
        <a href={cartPageUrl(cart.storefrontId, cart.cartId)} target="_blank" rel="noopener" className={link}>
          {t("view")}
        </a>
      ) : (
        <button
          type="button"
          className={link}
          onClick={() => {
            cart.setOpen(true);
            onDone?.();
          }}
        >
          {t("view")}
        </button>
      )}
    </p>
  );
}
