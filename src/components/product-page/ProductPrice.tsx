import { useTranslations, useLocale } from "next-intl";
import { formatLongDate } from "@/lib/format/date";
import type { Locale } from "@/i18n/locales";
import type { ProductSale } from "@/types/product";
import type { ProductPagePriceNote, ProductPageShippingNote } from "@/types/storefront";
import { PRICE_NOTE_TOKENS, SHIPPING_NOTE_TOKENS } from "./product-page-maps";
import { SalePrice } from "./SalePrice";

/**
 * The price and what qualifies it. EU consumer law wants the total price and
 * whether delivery is extra shown together, so the two notes sit on the same
 * line as the number rather than in a footnote.
 *
 * The two notes are ONE message, selected on both: how a tax note and a
 * shipping note combine is the translator's call, not a comma this file joins.
 *
 * During a sale the large size also says what the struck-through price is (the
 * EU's "lowest price in the 30 days before", when the page shows one) and when
 * the sale ends. The small size (the sticky bar) keeps to the one line.
 */
export function ProductPrice({
  priceCents,
  currency,
  sale,
  priceNote,
  shippingNote,
  isDigital,
  size = "lg",
}: {
  priceCents: number;
  currency: string;
  sale: ProductSale | null;
  priceNote: ProductPagePriceNote;
  shippingNote: ProductPageShippingNote;
  isDigital: boolean;
  size?: "lg" | "sm";
}) {
  const t = useTranslations("ProductPage");
  const locale = useLocale() as Locale;
  // A download is not shipped, whatever the store-wide note says.
  const effectiveShipping = isDigital ? "none" : shippingNote;
  const notes =
    priceNote === "none" && effectiveShipping === "none"
      ? ""
      : t("priceNotes", {
          price: PRICE_NOTE_TOKENS[priceNote],
          shipping: SHIPPING_NOTE_TOKENS[effectiveShipping],
        });

  const price = (
    <p className="flex flex-wrap items-baseline gap-x-2" data-product-price={priceCents}>
      <SalePrice
        priceCents={priceCents}
        currency={currency}
        sale={sale}
        size={size}
        priceClassName={size === "lg" ? "text-2xl font-semibold" : "text-base font-semibold"}
      />
      {notes && (
        <span className={size === "lg" ? "text-sm opacity-70" : "text-xs opacity-70"}>
          {notes}
        </span>
      )}
    </p>
  );
  if (size === "sm" || !sale || (sale.priorPriceCents === null && !sale.endsAt)) return price;

  return (
    <div className="flex flex-col gap-1">
      {price}
      {sale.priorPriceCents !== null && <p className="text-xs opacity-70">{t("sale.priorNote")}</p>}
      {sale.endsAt && (
        <p className="text-xs font-medium" data-product-sale-ends={sale.endsAt}>
          {/* A calendar date in the SERVER's time zone (UTC once deployed),
              like every other date on a buyer's page, which is rendered on
              the server only. East of it (all of Europe) that is never later
              than the buyer's own date, so it never promises a day the sale
              no longer has. The exact moment is in `dateTime`, and the price
              is read live at checkout either way. */}
          <time dateTime={sale.endsAt}>{t("sale.endsOn", { date: formatLongDate(sale.endsAt, locale) })}</time>
        </p>
      )}
    </div>
  );
}
