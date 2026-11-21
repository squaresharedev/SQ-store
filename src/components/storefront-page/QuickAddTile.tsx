"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useCart } from "@/components/cart/CartContext";
import { CART_ADDED_MS } from "@/components/cart/cart-look";
import type { TileQuickAddAction } from "@/components/storefront/ProductTileContent";
import type { CartRefusal } from "@/types/cart";

/**
 * A PRODUCT TILE WHOSE CARD ADDS TO THE CART, on a buyer's board (hosted, or
 * inside the embed frame).
 *
 * The card is still the way to the product's page, and its buy button is now
 * a button of its own. A button may not sit inside a link (screen readers
 * and keyboards cannot tell the two apart), so the link is laid UNDER the
 * card's face, full size and first in the frame, and the face over it lets
 * the pointer through everywhere but the button (pointer-events). A press
 * anywhere on the card still opens the page; the button adds one. A keyboard
 * meets the link, then the button. The link's focus ring is drawn over the
 * face, which would hide a ring drawn on the link itself.
 *
 * What the button says while it works is the card's own (ProductTileContent):
 * the cart's icon, a spinner, a tick and "Added" (the cart look's feedback),
 * or for a moment why it could not go in. The cart itself then does what the
 * seller chose (opens, or not), and the cart button's count jumps.
 */
export function QuickAddTile({
  href,
  newTab,
  frameClassName,
  productId,
  optionIds,
  title,
  renderFace,
}: {
  href: string;
  /** The embed frame: the page opens in a tab of its own. */
  newTab: boolean;
  /** The tile's frame and hover classes, as the plain tile's link wears them. */
  frameClassName: string;
  productId: string;
  /** The version the card adds: each group's one option, or none. */
  optionIds: readonly string[];
  title: string;
  /** The face, handed the card's action. Drawn over the link. */
  renderFace: (action: TileQuickAddAction | undefined) => ReactNode;
}) {
  const t = useTranslations("ProductPage.cart");
  const cart = useCart();
  const [state, setState] = useState<TileQuickAddAction["state"]>("idle");
  const [refusal, setRefusal] = useState<CartRefusal | null>(null);

  // "Added" and a refusal each stand for a moment, then the label is back.
  useEffect(() => {
    if (state !== "added" && state !== "refused") return;
    const timer = window.setTimeout(() => setState("idle"), CART_ADDED_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function add() {
    if (!cart || cart.preview || state === "adding") return;
    setRefusal(null);
    setState("adding");
    const result = await cart.add({ productId, optionIds, quantity: 1, source: "cart", title });
    if (result.ok) {
      setState("added");
    } else {
      setRefusal(result.error);
      setState("refused");
    }
  }

  const action: TileQuickAddAction | undefined = cart
    ? {
        state,
        words:
          state === "refused" && refusal
            ? t(`refusal.${refusal}`)
            : state === "added" && cart.look.feedback === "morph"
              ? t("added")
              : undefined,
        ariaLabel: t("addTitle", { title }),
        onAdd: () => void add(),
      }
    : undefined;

  return (
    <div className={cn(frameClassName, "block")} data-storefront-tile={productId} data-tile-quick-add-tile="">
      <a
        href={href}
        // noreferrer as well as noopener: the new tab is handed neither this
        // window nor the address of the page it was on.
        {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        aria-label={title}
        className="peer absolute inset-0 rounded-[inherit] outline-none"
        data-storefront-tile-link=""
      />
      <div className="pointer-events-none relative h-full w-full rounded-[inherit]">{renderFace(action)}</div>
      {/* The link's focus ring, over the face. The board's own ink: chosen to
          read on the seller's background (see StorefrontBoard). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 ring-2 ring-current ring-inset peer-focus-visible:opacity-100"
      />
      {/* What went wrong, for a screen reader: the button's words say it too. */}
      {state === "refused" && refusal && (
        <span role="status" className="sr-only">
          {t(`refusal.${refusal}`)}
        </span>
      )}
    </div>
  );
}
