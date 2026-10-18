import { CalendarClock, Tag } from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import { formatLongDate } from "@/lib/format/date";
import { formatCents } from "@/lib/format/money";
import type { Locale } from "@/i18n/locales";
import type { ProductSale } from "@/types/product";
import type {
  ProductPagePriceNote,
  ProductPageSaleStyle,
  ProductPageShippingNote,
} from "@/types/storefront";
import { PageTicket } from "./PageTicket";
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
 * During a sale the regular price is crossed out beside the price (SalePrice),
 * and the large size adds a TICKET under it that accounts for the crossing
 * out: how much comes off on its stub, when the sale ends, and one line saying
 * what the crossed-out price is. That line is where the EU's "lowest price in
 * the 30 days before" is stated: as the crossed-out price itself where the two
 * are the same, in figures where they are not, and not at all where the
 * records cannot prove it (then the crossed-out price is called what it is,
 * the regular price, and the stub carries a tag instead of a percentage). The
 * small size (the sticky bar) keeps to the one line.
 */
export function ProductPrice({
  priceCents,
  currency,
  sale,
  saleStyle,
  priceNote,
  shippingNote,
  isDigital,
  ink,
  radius,
  size = "lg",
}: {
  priceCents: number;
  currency: string;
  sale: ProductSale | null;
  /** How the regular price is crossed out. Absent = the default look. */
  saleStyle?: ProductPageSaleStyle;
  priceNote: ProductPagePriceNote;
  shippingNote: ProductPageShippingNote;
  isDigital: boolean;
  /** The ink of the surface this sits on, which the sale ticket is drawn in. */
  ink: string;
  /** The storefront's control corner, in px, for the ticket. */
  radius?: number;
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
        saleStyle={saleStyle}
        priceClassName={size === "lg" ? "text-2xl font-semibold" : "text-base font-semibold"}
      />
      {notes && (
        <span className={size === "lg" ? "text-sm opacity-70" : "text-xs opacity-70"}>
          {notes}
        </span>
      )}
    </p>
  );
  if (size === "sm" || !sale) return price;

  // WHAT THE CROSSED-OUT PRICE IS, in one line. `proven` when it is itself the
  // lowest price of the 30 days before; `lower` when an earlier price was
  // lower, which is then given; `regular` when the records cannot say.
  const prior = sale.priorPriceCents;
  const account = prior === null ? "regular" : prior === sale.regularPriceCents ? "proven" : "lower";
  const accountText =
    account === "proven"
      ? t("sale.priorNote")
      : account === "lower"
        ? t("sale.lowestNote", { price: formatCents(prior ?? 0, currency, locale) })
        : t("sale.regularNote");

  return (
    <div className="flex flex-col gap-3">
      {price}
      <PageTicket
        ink={ink}
        radius={radius}
        attributes={{ "data-product-sale-ticket": account }}
        // Heard already as "Was X, now Y" on the price itself.
        stub={
          sale.percentOff != null ? (
            <span aria-hidden="true" data-product-sale-percent={sale.percentOff}>
              {t("sale.percentOff", { percent: sale.percentOff })}
            </span>
          ) : (
            <Tag className="size-5" strokeWidth={2} aria-hidden="true" />
          )
        }
      >
        {/* A calendar date in the SERVER's time zone (UTC once deployed), like
            every other date on a buyer's page, which is rendered on the server
            only. East of it (all of Europe) that is never later than the
            buyer's own date, so it never promises a day the sale no longer
            has. The exact moment is in `dateTime`, and the price is read live
            at checkout either way. */}
        {sale.endsAt && (
          <p className="flex items-center gap-1.5 text-sm font-medium" data-product-sale-ends={sale.endsAt}>
            <CalendarClock className="size-3.5 shrink-0 opacity-70" strokeWidth={2} aria-hidden="true" />
            <time dateTime={sale.endsAt}>{t("sale.endsOn", { date: formatLongDate(sale.endsAt, locale) })}</time>
          </p>
        )}
        <p className="text-xs opacity-70" data-product-sale-note={account}>
          {accountText}
        </p>
      </PageTicket>
    </div>
  );
}
