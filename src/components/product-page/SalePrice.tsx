import { useLocale, useTranslations } from "next-intl";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import type { ProductSale } from "@/types/product";
import { DEFAULT_PRODUCT_PAGE_SALE_STYLE, type ProductPageSaleStyle } from "@/types/storefront";
import { SALE_PRICE_LOOKS } from "./product-page-maps";

/**
 * The stroke of the `slash` look: one smooth line from the price's lower left
 * to its upper right, in the text's own colour (so it follows the page's ink on
 * any backdrop). Stretched over the price's box, with a stroke that stays a
 * constant width however the box scales, and round ends.
 */
function PriceSlash() {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
      data-product-sale-slash=""
    >
      <line
        x1="3"
        y1="80"
        x2="97"
        y2="20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * A price, and the sale behind it: the product page's buy box and sticky bar,
 * and the checkout's item card all draw it here, so a sale reads the same
 * everywhere a buyer sees it.
 *
 * WHILE A SALE RUNS THE REGULAR PRICE IS CROSSED OUT beside the price, always
 * (a sale a buyer cannot see sells nothing). How it is crossed out is the
 * seller's choice of two looks (`saleStyle`, see PRODUCT_PAGE_SALE_STYLES);
 * what is shown is the same in both.
 *
 * The PERCENTAGE is a different matter: it appears only when the server
 * proved one, measured against the lowest price of the 30 days before the sale
 * (ProductSale.percentOff, lib/discounts/prior-price.ts), never against the
 * regular price. It is a chip on the small size only (the sticky bar, the
 * checkout's item card); the large size leaves it to the sale ticket under the
 * price (ProductPrice), which says it once, bigger.
 *
 * Screen readers hear "Was X, now Y" once instead of three separate numbers.
 */
export function SalePrice({
  priceCents,
  currency,
  sale,
  priceClassName,
  size = "lg",
  saleStyle = DEFAULT_PRODUCT_PAGE_SALE_STYLE,
}: {
  priceCents: number;
  currency: string;
  sale: ProductSale | null;
  /** The price's own type size; the struck price and the chip follow it. */
  priceClassName: string;
  size?: "lg" | "sm";
  saleStyle?: ProductPageSaleStyle;
}) {
  const t = useTranslations("ProductPage.sale");
  const locale = useLocale();
  const now = formatCents(priceCents, currency, locale);
  if (!sale) return <span className={priceClassName}>{now}</span>;

  const was = formatCents(sale.regularPriceCents, currency, locale);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2" data-product-sale={saleStyle}>
      <span className="sr-only">{t("wasNow", { was, now })}</span>
      <span aria-hidden="true" className={priceClassName}>
        {now}
      </span>
      <del aria-hidden="true" className={cn(SALE_PRICE_LOOKS[saleStyle][size])} data-product-sale-was={sale.regularPriceCents}>
        {was}
        {saleStyle === "slash" && <PriceSlash />}
      </del>
      {size === "sm" && sale.percentOff != null && (
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
