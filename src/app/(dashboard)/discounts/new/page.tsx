import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { DiscountFormView } from "@/components/discounts/DiscountFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { listProductChoices, saleChipHref } from "@/lib/discounts/queries";
import { DISCOUNTS_PATH } from "@/lib/discounts/paths";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discounts.form");
  return { title: t("newTitle") };
}

// PROTECTED by (dashboard)/layout.tsx, and gated to writers: a member who may
// not change prices is sent back to the list rather than shown a form whose
// save would be refused.
export default async function NewDiscountPage() {
  // The layout's session gate does not run again on a move between sections
  // (see ../layout.tsx, or ../../layout.tsx from a nested page): a page asks.
  await requireUser(DISCOUNTS_PATH);
  const [account, products, chipHref] = await Promise.all([
    getActiveAccount(),
    listProductChoices(),
    saleChipHref(),
  ]);
  if (!can(account?.role, "products.write")) redirect(DISCOUNTS_PATH);
  return <DiscountFormView discount={null} products={products} chipHref={chipHref} />;
}
