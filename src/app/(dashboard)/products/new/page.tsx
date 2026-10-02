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
import { PRODUCTS_PATH } from "@/lib/products/paths";
import { planRoom } from "@/lib/billing/limits";
import { PlanLimitNotice } from "@/components/billing/PlanLimitNotice";
import { PageHeader } from "@/components/layout/PageHeader";
import { BackLink } from "@/components/ui/BackLink";
import { pageShellClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";

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

  const t = await getTranslations("Products.page");

  // A store whose plan has no room for another product gets the limit and the
  // way to the plans, not a form to fill in and have refused at Save (the
  // action and the database hold the same line: lib/billing/limits.ts).
  const room = account ? await planRoom(account.accountId, "products") : null;
  if (room && room.left === 0) {
    return (
      <main className={cn(pageShellClass, "space-y-6")}>
        <BackLink href={PRODUCTS_PATH}>{t("back")}</BackLink>
        <PageHeader title={t("new.title")} subtitle={t("new.subtitle")} />
        <PlanLimitNotice limitKey="products" plan={room.plan} cap={room.cap} />
      </main>
    );
  }

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

  return (
    <ProductFormView
      title={t("new.title")}
      subtitle={t("new.subtitle")}
      // Set when the seller left a storefront designer to create this product
      // (ProductPicker's empty state): saving takes them back to that board.
      returnTo={storefrontReturnPath(params.next)}
      shippingChoices={shippingChoices}
      shippingPolicy={shippingPolicy}
      missingTraderDetails={identity.ok ? identity.missing : []}
    />
  );
}
