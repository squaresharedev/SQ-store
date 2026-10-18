"use client";

import { useTranslations } from "next-intl";
import { BuyerGone } from "@/components/product-page/BuyerNotice";

/**
 * The 404 for every buyer page that has no closer one of its own: "find your
 * order" on a shop that does not exist, and any address under /s/ that is not
 * a page at all (see s/[...missing]).
 *
 * Without this file those fell through to the app's root 404, which is the
 * dashboard's: it offers "Back to dashboard" and reassures the reader about
 * their account, to someone who has neither.
 */
export default function BuyerPageNotFound() {
  const t = useTranslations("ProductPage.pageNotFound");
  return <BuyerGone title={t("title")} body={t("body")} />;
}
