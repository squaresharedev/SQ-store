import { useLocale, useTranslations } from "next-intl";
import { formatCents } from "@/lib/format/money";
import type { ProductSale } from "@/types/product";

/**
 * A price, and the reduction it may announce: the product page's buy box and
 * sticky bar, and the checkout's item card all draw it here, so a sale reads
 * the same everywhere a buyer sees it.
 *
 * The struck-through price and the percent appear ONLY when the server proved
 * them (ProductSale.priorPriceCents, the lowest price of the 30 days before the
 * sale; lib/discounts/prior-price.ts). Without that the sale price is drawn as
 * the plain price: a reduction may not be claimed against a price nobody
 * charged.
 *
 * Screen readers hear "Was X, now Y" once instead of three separate numbers.
 */
export function SalePrice({
  priceCents,
  currency,
  sale,
  priceClassName,
  size = "lg",
}: {
  priceCents: number;
  currency: string;
  sale: ProductSale | null;
  /** The price's own type size; the struck price and the chip follow it. */
  priceClassName: string;
  size?: "lg" | "sm";
}) {
  const t = useTranslations("ProductPage.sale");
  const locale = useLocale();
  const now = formatCents(priceCents, currency, locale);
  const prior = sale?.priorPriceCents ?? null;
  if (prior === null) return <span className={priceClassName}>{now}</span>;

  const was = formatCents(prior, currency, locale);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2" data-product-sale="">
      <span className="sr-only">{t("wasNow", { was, now })}</span>
      <span aria-hidden="true" className={priceClassName}>
        {now}
      </span>
      <del aria-hidden="true" className={size === "lg" ? "text-base opacity-60" : "text-sm opacity-60"}>
        {was}
      </del>
      {sale?.percentOff != null && (
        <span
          aria-hidden="true"
          className="rounded-sm border border-current px-1 text-xs font-semibold"
          data-product-sale-percent={sale.percentOff}
        >
          {t("percentOff", { percent: sale.percentOff })}
        </span>
      )}
    </span>
  );
}
