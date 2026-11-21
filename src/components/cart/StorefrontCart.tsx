"use client";

import type { ReactNode } from "react";
import type { CartView } from "@/types/cart";
import type { LinkChannel } from "@/lib/storefront/product-page-url";
import type { CartPageConfig } from "@/types/storefront";
import { CartPreviewProvider, CartProvider } from "./CartContext";
import { CartAnnouncer, CartDrawer } from "./CartDrawer";
import type { CartPanelTheme } from "./CartPanel";
import type { CartDrawerMode, CartLook } from "./cart-look";

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
  previewOpen = false,
  onPreviewOpenChange,
  drawer = "dialog",
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
  /** A preview's cart open: where it starts, or, with onPreviewOpenChange,
   *  held by the owner (the designer opens it from its panel). */
  previewOpen?: boolean;
  onPreviewOpenChange?: (open: boolean) => void;
  /** Where a preview's panel opens (cart-look.ts): a buyer's page is always
   *  "dialog". "inline" draws it over this page, inside the page's own box. */
  drawer?: CartDrawerMode;
  look?: CartLook;
  children: ReactNode;
}) {
  if (!cart) return <>{children}</>;
  if (preview) {
    const panel = <CartDrawer theme={theme} />;
    return (
      <CartPreviewProvider
        storefrontId={storefrontId}
        config={cart}
        view={previewView}
        look={look}
        embedded={embedded}
        initiallyOpen={previewOpen}
        {...(onPreviewOpenChange ? { open: previewOpen, onOpenChange: onPreviewOpenChange } : {})}
        drawer={drawer}
      >
        {drawer === "inline" ? (
          // The page's own box: what the inline panel opens over, and the
          // width it switches from panel to sheet by.
          <div className="@container relative">
            {children}
            {panel}
          </div>
        ) : (
          <>
            {children}
            {panel}
          </>
        )}
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
