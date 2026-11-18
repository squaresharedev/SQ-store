import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getProduct } from "@/lib/products/queries";
import { getAddOnHabits, listAddOnChoices } from "@/lib/products/add-on-choices";
import { checkMany } from "@/lib/moderation/auto/check";
import { after } from "next/server";
import { ProductFormView } from "@/components/products/ProductFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { getShippingChoices } from "@/lib/storefront/queries";
import { getShippingPolicy } from "@/lib/settings/shipping-policy";
import { EMPTY_SHIPPING_POLICY } from "@/types/shipping-policy";
import { requireUser } from "@/lib/auth/session";
import { aiWritingFor, NO_AI_WRITING } from "@/lib/ai-suggestions";
import { checkoutProviderFor } from "@/lib/checkout/availability";
import { PRODUCTS_PATH } from "@/lib/products/paths";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Products.metadata.edit");
  return { title: t("title") };
}

// PROTECTED by (dashboard)/layout.tsx. Read-only members of the active store
// can't edit, so bounce them to the list instead of a non-savable form.
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // The layout's session gate does not run again on a move between sections
  // (see ../layout.tsx, or ../../layout.tsx from a nested page): a page asks.
  await requireUser(PRODUCTS_PATH);
  const { id } = await params;

  // Both reads in one round trip. Safe to overlap the permission check with
  // the product read because getProduct scopes itself to the active account
  // (and RLS backs that up) — the role check gates EDITING, not reading, and
  // nothing is rendered before it is applied below.
  const [account, product, shippingChoices, addOnChoices, addOnHabits] = await Promise.all([
    getActiveAccount(),
    getProduct(id),
    getShippingChoices(),
    listAddOnChoices(),
    getAddOnHabits(id),
  ]);
  if (!can(account?.role, "products.write")) redirect("/products");
  if (!product) notFound();
  // Opened while the automatic check has not judged it yet: ask now, after
  // this page is sent, rather than leave it to the sweep. The notice on the
  // page says to reload, and the reload is then usually the answer.
  if (product.removal?.kind === "pending") {
    const productId = product.id;
    after(() => checkMany("product", [productId]));
  }

  // All four reads are independent of each other: run them in one round trip.
  //
  // identity: the form disables "Active" for a store that may not publish yet
  // (see the create route for why this check is here up front).
  //
  // shippingPolicy: scoped to the signed-in user (account.userId), not the
  // active account, same as Settings > Shipping writes it.
  //
  // ai: the shell already read this store's plan this request (cached).
  //
  // checkoutOpen: where the buy button goes (cta-target.ts order).
  const [identity, shippingPolicy, ai, checkoutOpen] = await Promise.all([
    account
      ? getTraderIdentityStatus(account.accountId)
      : Promise.resolve({ ok: true as const, missing: [] }),
    account ? getShippingPolicy(account.userId) : Promise.resolve(EMPTY_SHIPPING_POLICY),
    account
      ? aiWritingFor(account.accountId, account.userId)
      : Promise.resolve(NO_AI_WRITING),
    account
      ? checkoutProviderFor(account.accountId).then((p) => p !== null)
      : Promise.resolve(false),
  ]);
  const t = await getTranslations("Products.page.edit");

  return (
    <ProductFormView
      title={t("title")}
      subtitle={t("subtitle")}
      product={product}
      shippingChoices={shippingChoices}
      shippingPolicy={shippingPolicy}
      missingTraderDetails={identity.ok ? identity.missing : []}
      addOnChoices={addOnChoices}
      addOnHabits={addOnHabits}
      ai={ai}
      checkoutOpen={checkoutOpen}
    />
  );
}
