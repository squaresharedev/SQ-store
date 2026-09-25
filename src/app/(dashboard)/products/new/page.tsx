import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ProductFormView } from "@/components/products/ProductFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { getShippingChoices } from "@/lib/storefront/queries";
import { getShippingPolicy } from "@/lib/settings/shipping-policy";
import { EMPTY_SHIPPING_POLICY } from "@/types/shipping-policy";
import { storefrontReturnPath } from "@/lib/products/return-path";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Products.metadata.new");
  return { title: t("title") };
}

// PROTECTED by (dashboard)/layout.tsx. Also gated to writers: a read-only
// member of the active store can't create products, so we bounce them back to
// the list rather than show a form whose save would be rejected.
export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  // Overlapped: the shipping read is scoped to the active account on its own
  // (and RLS backs that up), and nothing is rendered before the role check.
  const [account, shippingChoices, params] = await Promise.all([
    getActiveAccount(),
    getShippingChoices(),
    searchParams,
  ]);
  if (!can(account?.role, "products.write")) redirect("/products");

  // What the form needs to know before it offers "Active": the server refuses
  // that status without the store's trader details (lib/products/actions.ts),
  // so the control says so up front rather than letting a seller fill in a
  // whole product and find out at Save.
  const identity = account
    ? await getTraderIdentityStatus(account.accountId)
    : { ok: true as const, missing: [] };

  // Scoped to the SIGNED-IN user (`account.userId`), not the active account:
  // that is what `saveShippingPolicy` writes to, same as Settings › Shipping
  // itself. The shipping-terms modal edits this document directly.
  const shippingPolicy = account
    ? await getShippingPolicy(account.userId)
    : EMPTY_SHIPPING_POLICY;

  const t = await getTranslations("Products.page.new");

  return (
    <ProductFormView
      title={t("title")}
      subtitle={t("subtitle")}
      // Set when the seller left a storefront designer to create this product
      // (ProductPicker's empty state): saving takes them back to that board.
      returnTo={storefrontReturnPath(params.next)}
      shippingChoices={shippingChoices}
      shippingPolicy={shippingPolicy}
      missingTraderDetails={identity.ok ? identity.missing : []}
    />
  );
}
