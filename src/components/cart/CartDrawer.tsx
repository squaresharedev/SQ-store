"use client";

import { useTranslations } from "next-intl";
import { Modal } from "@/components/ui/modal";
import { storefrontOverlayVars } from "@/components/product-page/product-page-maps";
import { useCart } from "./CartContext";
import { CartContents, CartSummary, type CartPanelTheme } from "./CartPanel";

/**
 * THE CART PANEL: the cart beside the page it was opened over (a sheet on a
 * phone), in the shop's own ink, with its summary and checkout button kept in
 * view while the lines scroll. The shared dialog (ui/Modal) does focus,
 * Escape and the scroll lock, so this is only what is in it. Never inside the
 * embedded shop: a frame that grows with its content has no screen edge to
 * open against (the cart opens on our page instead, CartButton).
 */
export function CartDrawer({ theme }: { theme: CartPanelTheme }) {
  const t = useTranslations("ProductPage.cart");
  const cart = useCart();
  if (!cart || cart.embedded) return null;
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
