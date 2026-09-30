import type { CtaAppearance } from "@/components/product-page/product-page-maps";

/**
 * How many, pinned to the corner of the item's photo the way a basket shows
 * it, so a buyer who picked three sees three without reading a line. Painted
 * in the pay button's own colours (the one action on the page), and silent to
 * assistive tech: the page states the number in words elsewhere.
 *
 * Absent at one, where a "1" badge is noise. Server-compatible; the checkout
 * wraps it in QuantityBadge to follow the live pick, the order page passes the
 * ordered quantity. The photo's wrapper must be `relative`.
 */
export function QuantityMark({ quantity, cta }: { quantity: number; cta: CtaAppearance }) {
  if (quantity <= 1) return null;
  return (
    <span
      className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums shadow-sm"
      style={{ backgroundColor: cta.fill, color: cta.text }}
      aria-hidden="true"
      data-quantity-mark={quantity}
    >
      {quantity}
    </span>
  );
}
