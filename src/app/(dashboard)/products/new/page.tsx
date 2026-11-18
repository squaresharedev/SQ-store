import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ProductFormView } from "@/components/products/ProductFormView";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getAccountSellerIdentity, getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { checkoutProviderFor } from "@/lib/checkout/availability";
import { getShippingChoices } from "@/lib/storefront/queries";
import { getAddOnHabits, listAddOnChoices } from "@/lib/products/add-on-choices";
import { predictProductDefaults } from "@/lib/predictions";
import { aiWritingFor, NO_AI_WRITING } from "@/lib/ai-suggestions";
import { listRecentProductFacts } from "@/lib/products/queries";
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
import { requireUser } from "@/lib/auth/session";

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
  // The layout's session gate does not run again on a move between sections
  // (see ../layout.tsx, or ../../layout.tsx from a nested page): a page asks.
  await requireUser(PRODUCTS_PATH);
  // Overlapped: the shipping read is scoped to the active account on its own
  // (and RLS backs that up), and nothing is rendered before the role check.
  const [account, shippingChoices, params, addOnChoices, addOnHabits, recentProducts] = await Promise.all([
    getActiveAccount(),
    getShippingChoices(),
    searchParams,
    listAddOnChoices(),
    getAddOnHabits(null),
    listRecentProductFacts(),
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

  // All five reads are independent of each other and of the room check: run
  // them in one round trip. Each falls back to its safe default when no active
  // account is present.
  //
  // identity: the server refuses "Active" without trader details (lib/products/
  // actions.ts), so the form says so up front rather than at Save.
  //
  // shippingPolicy: scoped to the signed-in user (account.userId), not the
  // active account, same as Settings > Shipping writes it.
  //
  // ai: the shell already read this store's plan this request (cached).
  //
  // seller: the business country prices the first product (lib/predictions
  // homeCurrency); a read failure leaves the usual default.
  //
  // checkoutOpen: where the buy button goes (cta-target.ts order).
  const [identity, shippingPolicy, ai, seller, checkoutOpen] = await Promise.all([
    account
      ? getTraderIdentityStatus(account.accountId)
      : Promise.resolve({ ok: true as const, missing: [] }),
    account ? getShippingPolicy(account.userId) : Promise.resolve(EMPTY_SHIPPING_POLICY),
    account
      ? aiWritingFor(account.accountId, account.userId)
      : Promise.resolve(NO_AI_WRITING),
    account
      ? getAccountSellerIdentity(account.accountId)
      : Promise.resolve(null),
    account
      ? checkoutProviderFor(account.accountId).then((p) => p !== null)
      : Promise.resolve(false),
  ]);

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
      addOnChoices={addOnChoices}
      addOnHabits={addOnHabits}
      suggested={predictProductDefaults(
        recentProducts,
        shippingChoices.profiles.map((profile) => profile.id),
        seller?.country,
      )}
      ai={ai}
      checkoutOpen={checkoutOpen}
    />
  );
}
