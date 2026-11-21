"use client";

import type { ReactNode } from "react";
import type { CartView } from "@/types/cart";
import type { LinkChannel } from "@/lib/storefront/product-page-url";
import type { CartPageConfig } from "@/types/storefront";
import { CartPreviewProvider, CartProvider } from "./CartContext";
import { CartAnnouncer, CartDrawer } from "./CartDrawer";
import type { CartPanelTheme } from "./CartPanel";
import type { CartLook } from "./cart-look";

/**
 * A buyer page's cart, in one element: the provider every cart control on the
 * page reads (the cart button, "Add to cart", tile quick adds), the panel and
 * the screen reader's announcements. Nothing at all where the storefront has
 * no cart (`cart` null), so a page without one is exactly the page it was.
 *
 * In the editor and the lab (`preview`) the same controls are drawn from
 * fixed data (`previewView`) and send nothing.
 */
export function StorefrontCart({
  storefrontId,
  cart,
  theme,
  embedded = false,
  via = null,
  preview = false,
  previewView = null,
  look,
  children,
}: {
  storefrontId: string;
  cart: CartPageConfig | null;
  theme: CartPanelTheme;
  embedded?: boolean;
  /** How the buyer arrived (`?via=`): the embed frame is always "embed". */
  via?: LinkChannel | null;
  preview?: boolean;
  previewView?: CartView | null;
  look?: CartLook;
  children: ReactNode;
}) {
  if (!cart) return <>{children}</>;
  if (preview) {
    return (
      <CartPreviewProvider storefrontId={storefrontId} config={cart} view={previewView} look={look} embedded={embedded}>
        {children}
        <CartDrawer theme={theme} />
      </CartPreviewProvider>
    );
  }
  return (
    <CartProvider storefrontId={storefrontId} config={cart} embedded={embedded} via={embedded ? "embed" : via} look={look}>
      {children}
      <CartDrawer theme={theme} />
      <CartAnnouncer />
    </CartProvider>
  );
}
