"use client";

import { useQuantity } from "@/components/product-page/QuantityContext";
import type { CtaAppearance } from "@/components/product-page/product-page-maps";
import { QuantityMark } from "./QuantityMark";

/** The checkout's live quantity badge: the buyer's current pick, from the
 *  page's QuantityContext. See QuantityMark for what it draws. */
export function QuantityBadge({ cta }: { cta: CtaAppearance }) {
  const { quantity } = useQuantity();
  return <QuantityMark quantity={quantity} cta={cta} />;
}
