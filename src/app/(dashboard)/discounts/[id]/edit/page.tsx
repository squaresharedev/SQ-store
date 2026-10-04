import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { DiscountFormView } from "@/components/discounts/DiscountFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getDiscount, listProductChoices } from "@/lib/discounts/queries";
import { DISCOUNTS_PATH } from "@/lib/discounts/paths";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discounts.form");
  return { title: t("editTitle") };
}

// PROTECTED by (dashboard)/layout.tsx and gated to writers, like the create
// route. The discount is read in the active store only, so an id from another
// store (or a deleted one) is simply not found.
export default async function EditDiscountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [account, discount, products] = await Promise.all([
    getActiveAccount(),
    getDiscount(id),
    listProductChoices(),
  ]);
  if (!can(account?.role, "products.write")) redirect(DISCOUNTS_PATH);
  if (!discount) notFound();
  return <DiscountFormView discount={discount} products={products} />;
}
