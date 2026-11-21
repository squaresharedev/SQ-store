"use client";

import type { CSSProperties } from "react";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { modalTitleClass, overlayCloseButtonClass, overlaySurfaceClass } from "@/components/ui/control-styles";
import { storefrontOverlayVars } from "@/components/product-page/product-page-maps";
import { EditableText } from "@/components/checkout/EditableText";
import { CART_TITLE_MAX } from "@/types/storefront";
import { useCart } from "./CartContext";
import { CartContents, CartSummary, type CartPanelTheme } from "./CartPanel";

/**
 * THE CART PANEL'S FACE, without the dialog around it: the cart's title, its
 * lines scrolling, and the summary pinned at the foot, on the shop's own
 * overlay surface. Drawn where a full-screen dialog cannot be: inside an
 * artboard on the storefront designer (over the product page it opens on, or
 * as a cart of its own) and in the cart lab. A buyer's cart is CartDrawer:
 * the same contents inside ui/Modal, which adds focus, Escape and the scroll
 * lock.
 *
 * `onClose` makes the close button work; without it the button is drawn and
 * does nothing (a cart shown, not opened).
 *
 * On the designer's canvas a click on the cart opens the Cart settings
 * (`data-setting-hotspot`), the heading is typed straight into, and the
 * close button only closes.
 */
export function CartPanelSurface({
  theme,
  onClose,
  className,
  style,
}: {
  theme: CartPanelTheme;
  onClose?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const t = useTranslations("ProductPage.cart");
  const tActions = useTranslations("Common.actions");
  const cart = useCart();
  if (!cart) return null;
  const title = cart.config.title ?? t("title");
  const hasLines = (cart.view?.lines.length ?? 0) > 0;
  const closeClass = cn(overlayCloseButtonClass, "-mr-1.5 -mt-1.5");

  return (
    <div
      role="dialog"
      aria-label={title}
      className={cn(overlaySurfaceClass, "flex flex-col", className)}
      style={{ ...storefrontOverlayVars(theme.ink, theme.cornerRadius), ...style }}
      data-cart-panel-surface=""
      data-setting-hotspot="cart"
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <EditableText
          as="h2"
          field="cartTitle"
          value={cart.config.title}
          fallback={t("title")}
          maxLength={CART_TITLE_MAX}
          ariaLabel={t("editTitle")}
          className={modalTitleClass}
        />
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label={tActions("close")}
            className={closeClass}
            data-setting-skip=""
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        ) : (
          <span className={closeClass} aria-hidden="true">
            <X className="size-5" />
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4" data-cart-drawer="">
        <CartContents theme={theme} onShop={onClose} />
      </div>
      {hasLines && (
        <div className="border-t border-border bg-popover px-6 py-4">
          <CartSummary theme={theme} />
        </div>
      )}
    </div>
  );
}
