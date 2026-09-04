import { formatCents } from "@/lib/format/money";
import type { ProductPagePriceNote, ProductPageShippingNote } from "@/types/storefront";
import { PRICE_NOTE_LABELS, SHIPPING_NOTE_LABELS } from "./product-page-maps";

/**
 * The price and what qualifies it. EU consumer law wants the total price and
 * whether delivery is extra shown together, so the two notes sit on the same
 * line as the number rather than in a footnote.
 */
export function ProductPrice({
  priceCents,
  currency,
  priceNote,
  shippingNote,
  isDigital,
  size = "lg",
}: {
  priceCents: number;
  currency: string;
  priceNote: ProductPagePriceNote;
  shippingNote: ProductPageShippingNote;
  isDigital: boolean;
  size?: "lg" | "sm";
}) {
  const notes = [
    PRICE_NOTE_LABELS[priceNote],
    // A download is not shipped, whatever the store-wide note says.
    isDigital ? "" : SHIPPING_NOTE_LABELS[shippingNote],
  ].filter(Boolean);

  return (
    <p className="flex flex-wrap items-baseline gap-x-2" data-product-price={priceCents}>
      <span className={size === "lg" ? "text-2xl font-semibold" : "text-base font-semibold"}>
        {formatCents(priceCents, currency)}
      </span>
      {notes.length > 0 && (
        <span className={size === "lg" ? "text-sm opacity-70" : "text-xs opacity-70"}>
          {notes.join(", ")}
        </span>
      )}
    </p>
  );
}
