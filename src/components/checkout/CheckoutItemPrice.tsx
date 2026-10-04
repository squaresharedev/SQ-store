"use client";

import { priceOrder } from "@/lib/discounts/pricing";
import { SalePrice } from "@/components/product-page/SalePrice";
import { useQuantity } from "@/components/product-page/QuantityContext";
import type { Currency, ProductSale } from "@/types/product";
import { useAppliedCode } from "./DiscountCodeContext";

/**
 * The item card's unit price. The sale price (with what it may announce)
 * while the sale is the better deal; the REGULAR price once a code beats it,
 * because the totals then take the code off the regular price and a card still
 * showing the sale price would add up to something else.
 */
export function CheckoutItemPrice({
  priceCents,
  currency,
  sale,
  className,
}: {
  priceCents: number;
  currency: Currency;
  sale: ProductSale | null;
  className: string;
}) {
  const { quantity } = useQuantity();
  const { terms } = useAppliedCode();
  const regular = sale?.regularPriceCents ?? priceCents;
  const priced = priceOrder({
    regularUnitCents: regular,
    currency,
    quantity,
    saleUnitCents: sale ? priceCents : null,
    code: terms?.value ?? null,
  });
  const codeWon = priced.applied === "code";
  return (
    <p className={className} data-checkout-unit-price={priced.unitPriceCents}>
      <SalePrice
        priceCents={priced.unitPriceCents}
        currency={currency}
        sale={codeWon ? null : sale}
        size="sm"
        priceClassName=""
      />
    </p>
  );
}
