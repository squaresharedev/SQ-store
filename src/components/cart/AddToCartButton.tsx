"use client";

import { useEffect, useState } from "react";
import { Check, ShoppingBag } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import {
  CTA_BUTTON_CLASS,
  ctaOutlineStyle,
  ctaStyle,
  type CtaAppearance,
} from "@/components/product-page/product-page-maps";
import { useOptionSelection } from "@/components/product-page/OptionContext";
import { useQuantity } from "@/components/product-page/QuantityContext";
import { useAddOns } from "@/components/product-page/AddOnsContext";
import { Spinner } from "@/components/ui/spinner";
import type { CartRefusal } from "@/types/cart";
import { useCart } from "./CartContext";
import { CART_ADDED_MS } from "./cart-look";
import { CartAddedNote } from "./CartAddedNote";

/**
 * "ADD TO CART" on a product page: the version and quantity on screen, and
 * whatever was taken from "Add to your order", go into the cart, and the
 * buyer stays on the page. The button says "Added" for a moment (the cart
 * look's feedback), the cart button's count jumps, and then, as the seller
 * chose, the cart opens beside the page or a short note offers it.
 *
 * Requests only: the cart route checks every line by the quote's own rules
 * and refuses with a reason (shown under the button), never stores a broken
 * line. Renders nothing where the page has no cart.
 */
export function AddToCartButton({
  productId,
  title,
  cta,
  ink,
  primary,
  label,
  soldOut,
  className,
}: {
  productId: string;
  title: string;
  cta: CtaAppearance;
  /** The page's ink: the second button's outline and the focus ring. */
  ink: string;
  /** Filled like the buy button (the seller leads with the cart), or outlined
   *  beside it. */
  primary: boolean;
  /** The seller's own words, else "Add to cart". */
  label?: string;
  soldOut: boolean;
  className?: string;
}) {
  const t = useTranslations("ProductPage.cart");
  const tCta = useTranslations("ProductPage.cta");
  const cart = useCart();
  const { unavailableIn, selectedIds } = useOptionSelection();
  const { quantity } = useQuantity();
  const { picks } = useAddOns();
  const [state, setState] = useState<"idle" | "adding" | "added">("idle");
  const [refusal, setRefusal] = useState<CartRefusal | null>(null);
  const [noted, setNoted] = useState(false);

  useEffect(() => {
    if (state !== "added") return;
    const timer = window.setTimeout(() => setState("idle"), CART_ADDED_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (!cart) return null;
  const unavailable = soldOut || unavailableIn !== null;
  const words = soldOut
    ? t("refusal.sold_out")
    : unavailableIn
      ? tCta("unavailableIn", { group: unavailableIn.name.toLowerCase() })
      : state === "adding"
        ? t("adding")
        : state === "added" && cart.look.feedback === "morph"
          ? t("added")
          : (label ?? t("add"));

  async function add() {
    if (!cart || unavailable || state === "adding" || cart.preview) return;
    setRefusal(null);
    setNoted(false);
    setState("adding");
    const result = await cart.add({ productId, optionIds: [...selectedIds], quantity, source: "cart", title });
    if (!result.ok) {
      setState("idle");
      setRefusal(result.error);
      return;
    }
    // What was taken from "Add to your order" goes in beside it, one each.
    for (const pick of picks) {
      await cart.add({ productId: pick.productId, optionIds: pick.optionIds, quantity: 1, source: "add_on", title });
    }
    setState("added");
    if (cart.embedded || cart.config.afterAdd === "note") setNoted(true);
  }

  const Icon = state === "added" && cart.look.feedback === "morph" ? Check : ShoppingBag;
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-add-to-cart={state}>
      <button
        type="button"
        onClick={() => void add()}
        aria-disabled={unavailable || state === "adding"}
        className={cn(
          CTA_BUTTON_CLASS,
          unavailable ? "cursor-default opacity-50" : "hover:opacity-90",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
        )}
        style={{ ...(primary ? ctaStyle(cta) : ctaOutlineStyle(cta, ink)), outlineColor: ink }}
        data-cta-fill={primary ? cta.fill : undefined}
      >
        {state === "adding" ? (
          <Spinner className="size-4" />
        ) : (
          !unavailable && <Icon className="size-4" strokeWidth={2.25} aria-hidden="true" />
        )}
        {words}
      </button>
      {refusal && (
        <p className="text-center text-xs font-medium" role="alert" data-add-to-cart-refusal={refusal}>
          {t(`refusal.${refusal}`)}
        </p>
      )}
      {noted && <CartAddedNote ink={ink} onDone={() => setNoted(false)} />}
    </div>
  );
}
