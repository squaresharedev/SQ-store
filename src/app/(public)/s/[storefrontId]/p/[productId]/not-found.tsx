"use client";

import { useTranslations } from "next-intl";
import { BuyerGone } from "@/components/product-page/BuyerNotice";

/**
 * The buyer-facing page for every way a product can be unavailable: unknown
 * ids, a draft, a product not placed on this storefront, or product pages
 * switched off entirely. All failures look the same: nothing is enumerable.
 *
 * No internal error slug (BUY-04): `err_product_unavailable` is an
 * implementation detail that tells a buyer nothing and tells an attacker which
 * surface to probe. The screen itself, and why it carries no footer, is
 * BuyerNotice's.
 */
export default function ProductNotFound() {
  const t = useTranslations("ProductPage.notFound");
  return <BuyerGone title={t("title")} body={t("body")} />;
}
