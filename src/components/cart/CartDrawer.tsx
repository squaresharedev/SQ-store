"use client";

import type { CSSProperties } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/modal";
import { overlayScrimClass } from "@/components/ui/control-styles";
import { storefrontOverlayVars } from "@/components/product-page/product-page-maps";
import { useCart } from "./CartContext";
import { CartContents, CartSummary, type CartPanelTheme } from "./CartPanel";
import { CartPanelSurface } from "./CartPanelSurface";
import { CART_PREVIEW_SCREEN_PX } from "./cart-look";

/**
 * THE CART PANEL: the cart beside the page it was opened over (a sheet on a
 * phone), in the shop's own ink, with its summary and checkout button kept in
 * view while the lines scroll. The shared dialog (ui/Modal) does focus,
 * Escape and the scroll lock, so this is only what is in it. Never inside the
 * embedded shop: a frame that grows with its content has no screen edge to
 * open against (the cart opens on our page instead, CartButton).
 *
 * In a preview inside an artboard ("inline") it opens over the page it
 * belongs to, inside the artboard's frame and one screen tall: the panel at
 * the right edge, a sheet from the bottom of the screen at phone width (the
 * same switch ui/Modal makes, by the artboard's width rather than the
 * window's).
 */
export function CartDrawer({ theme }: { theme: CartPanelTheme }) {
  const t = useTranslations("ProductPage.cart");
  const cart = useCart();
  if (!cart || cart.embedded || cart.drawer === "none") return null;
  if (cart.drawer === "inline") {
    if (!cart.open) return null;
    const close = () => cart.setOpen(false);
    return (
      <div
        className="absolute inset-x-0 top-0 z-40"
        style={{ "--cart-screen": `${CART_PREVIEW_SCREEN_PX}px`, height: "var(--cart-screen)" } as CSSProperties}
        data-cart-drawer-inline=""
      >
        <div className={cn(overlayScrimClass, "absolute")} onClick={close} aria-hidden="true" data-setting-skip="" />
        <CartPanelSurface
          theme={theme}
          onClose={close}
          className="absolute inset-x-0 bottom-0 h-[calc(var(--cart-screen)*0.9)] @xl:inset-x-auto @xl:right-0 @xl:h-full @xl:w-full @xl:max-w-md"
        />
      </div>
    );
  }
  return (
    <Modal
      open={cart.open}
      onClose={() => cart.setOpen(false)}
      title={cart.config.title ?? t("title")}
      placement="side"
      themeVars={storefrontOverlayVars(theme.ink, theme.cornerRadius)}
      footer={<CartSummary theme={theme} />}
    >
      <div data-cart-drawer="">
        <CartContents theme={theme} onShop={() => cart.setOpen(false)} />
      </div>
    </Modal>
  );
}

/** What the last change to the cart was, said to a screen reader. Always in
 *  the page (a live region must exist before it speaks). */
export function CartAnnouncer() {
  const cart = useCart();
  if (!cart) return null;
  return (
    <p aria-live="polite" className="sr-only" data-cart-announcer="">
      {cart.announcement}
    </p>
  );
}
