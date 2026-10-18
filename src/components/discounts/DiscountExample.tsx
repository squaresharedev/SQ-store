import { useLocale, useTranslations } from "next-intl";
import { ProductThumb } from "@/components/ui/ProductThumb";
import { eyebrowClass, inkBadgeClass } from "@/components/ui/surface-styles";
import { formatCents } from "@/lib/format/money";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/locales";
import type { DiscountProductChoice, DiscountValue } from "@/types/discount";

/**
 * WHAT THE DISCOUNT DOES, SHOWN ON ONE PRODUCT: its photo with what comes off
 * stamped over the corner, the regular price struck through, and the price it
 * becomes. The form's summary closes with it, so a seller sees the effect of
 * what they are about to save instead of reading a sentence about it.
 *
 * The picture is for the eye and says nothing a screen reader hears: the
 * caption is the same fact as one sentence ("Example: Blue mug at €24.00 costs
 * €21.60."), heard once.
 *
 * The stamp is the discount as the seller typed it for a percentage, and what
 * actually comes off THIS product for an amount (which is less than the amount
 * typed when the price has little room above the smallest payment).
 *
 * For a sale this is what a buyer is shown too: the regular price crossed out
 * beside the new one, on the tile and on the product page.
 */
export function DiscountExample({
  product,
  value,
  nowCents,
}: {
  /** The product the example is worked on. */
  product: DiscountProductChoice;
  value: DiscountValue;
  /** What one costs under the discount (lib/discounts/pricing.ts priceOfOne). */
  nowCents: number;
}) {
  const t = useTranslations("Discounts.form.summary");
  const tSale = useTranslations("ProductPage.sale");
  const locale = useLocale() as Locale;
  const regular = formatCents(product.priceCents, product.currency, locale);
  const now = formatCents(nowCents, product.currency, locale);
  const off =
    value.type === "percent"
      ? tSale("percentOff", { percent: value.percentOff })
      : formatCents(nowCents - product.priceCents, product.currency, locale);

  return (
    <figure className="mt-3 flex items-center gap-4 border-t border-border pt-4" data-discount-example={nowCents}>
      <figcaption className="sr-only">{t("example", { title: product.title, regular, now })}</figcaption>
      <div aria-hidden="true" className="relative shrink-0">
        <ProductThumb src={product.imageUrl} className="size-24 rounded-md" />
        <span
          className={cn(inkBadgeClass, "absolute left-1.5 top-1.5 tabular-nums shadow-xs")}
          data-discount-example-off=""
        >
          {off}
        </span>
      </div>
      <div aria-hidden="true" className="flex min-w-0 flex-col gap-1">
        <span className={eyebrowClass}>{t("exampleLabel")}</span>
        <span className="truncate text-sm font-medium text-foreground">{product.title}</span>
        <span className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
          <del className="text-sm text-muted-foreground" data-discount-example-was="">
            {regular}
          </del>
          <span className="text-xl font-semibold leading-tight text-foreground" data-discount-example-now="">
            {now}
          </span>
        </span>
      </div>
    </figure>
  );
}
