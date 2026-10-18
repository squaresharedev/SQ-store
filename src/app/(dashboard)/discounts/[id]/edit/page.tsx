import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { DiscountFormView } from "@/components/discounts/DiscountFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getDiscount, listProductChoices, saleChipHref } from "@/lib/discounts/queries";
import { DISCOUNTS_PATH } from "@/lib/discounts/paths";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discounts.form");
  return { title: t("editTitle") };
}

// PROTECTED by (dashboard)/layout.tsx and gated to writers, like the create
// route. The discount is read in the active store only, so an id from another
// store (or a deleted one) is simply not found.
export default async function EditDiscountPage({ params }: { params: Promise<{ id: string }> }) {
  // The layout's session gate does not run again on a move between sections
  // (see ../layout.tsx, or ../../layout.tsx from a nested page): a page asks.
  await requireUser(DISCOUNTS_PATH);
  const { id } = await params;
  const [account, discount, products, chipHref] = await Promise.all([
    getActiveAccount(),
    getDiscount(id),
    listProductChoices(),
    saleChipHref(),
  ]);
  if (!can(account?.role, "products.write")) redirect(DISCOUNTS_PATH);
  if (!discount) notFound();
  return <DiscountFormView discount={discount} products={products} chipHref={chipHref} />;
}
