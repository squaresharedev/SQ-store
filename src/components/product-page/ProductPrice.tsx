import { useTranslations, useLocale } from "next-intl";
import { formatCents } from "@/lib/format/money";
import type { ProductPagePriceNote, ProductPageShippingNote } from "@/types/storefront";
import { PRICE_NOTE_TOKENS, SHIPPING_NOTE_TOKENS } from "./product-page-maps";

/**
 * The price and what qualifies it. EU consumer law wants the total price and
 * whether delivery is extra shown together, so the two notes sit on the same
 * line as the number rather than in a footnote.
 *
 * The two notes are ONE message, selected on both: how a tax note and a
 * shipping note combine is the translator's call, not a comma this file joins.
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
  const t = useTranslations("ProductPage");
  const locale = useLocale();
  // A download is not shipped, whatever the store-wide note says.
  const effectiveShipping = isDigital ? "none" : shippingNote;
  const notes =
    priceNote === "none" && effectiveShipping === "none"
      ? ""
      : t("priceNotes", {
          price: PRICE_NOTE_TOKENS[priceNote],
          shipping: SHIPPING_NOTE_TOKENS[effectiveShipping],
        });

  return (
    <p className="flex flex-wrap items-baseline gap-x-2" data-product-price={priceCents}>
      <span className={size === "lg" ? "text-2xl font-semibold" : "text-base font-semibold"}>
        {formatCents(priceCents, currency, locale)}
      </span>
      {notes && (
        <span className={size === "lg" ? "text-sm opacity-70" : "text-xs opacity-70"}>
          {notes}
        </span>
      )}
    </p>
  );
}
