import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { DiscountFormView } from "@/components/discounts/DiscountFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { listDiscounts, listProductChoices, saleChipLink } from "@/lib/discounts/queries";
import { predictDiscountDefaults } from "@/lib/predictions";
import { DISCOUNTS_PATH, NEW_SALE_PRODUCT_PARAM } from "@/lib/discounts/paths";
import { requireUser } from "@/lib/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Discounts.form");
  return { title: t("newTitle") };
}

// PROTECTED by (dashboard)/layout.tsx, and gated to writers: a member who may
// not change prices is sent back to the list rather than shown a form whose
// save would be refused.
export default async function NewDiscountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout's session gate does not run again on a move between sections
  // (see ../layout.tsx, or ../../layout.tsx from a nested page): a page asks.
  await requireUser(DISCOUNTS_PATH);
  const [account, products, chip, discounts, query] = await Promise.all([
    getActiveAccount(),
    listProductChoices(),
    saleChipLink(),
    listDiscounts(),
    searchParams,
  ]);
  if (!can(account?.role, "products.write")) redirect(DISCOUNTS_PATH);
  // A sale on one product, asked for from the designer. Only an id from the
  // store's own list counts; anything else opens the plain form.
  const wanted = query[NEW_SALE_PRODUCT_PARAM];
  const forProduct = products.find((product) => product.id === wanted)?.id ?? null;
  return (
    <DiscountFormView
      discount={null}
      products={products}
      chip={chip}
      suggested={predictDiscountDefaults(discounts)}
      forProduct={forProduct}
    />
  );
}
