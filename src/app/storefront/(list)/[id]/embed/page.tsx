import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { pageColumnNarrowClass, pageShellClass } from "@/components/ui/surface-styles";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmbedSettings } from "@/components/storefront/EmbedSettings";
import { listAllProducts } from "@/lib/products/queries";
import { getStorefrontSummary } from "@/lib/storefront/queries";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";

export async function generateMetadata() {
  const t = await getTranslations("Storefront.embed");
  return { title: t("title") };
}

// Embed settings for one storefront. Wears the dashboard shell via
// (list)/layout.tsx; auth is enforced by storefront/layout.tsx. Like the
// editor, this is a write surface: read-only members go back to the list,
// where they can still see every storefront.
export default async function StorefrontEmbedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const account = await getActiveAccount();
  if (!can(account?.role, "storefront.write")) redirect(STOREFRONT_LIST_PATH);

  const [t, tDesigner, storefront, products, identity] = await Promise.all([
    getTranslations("Storefront.embed"),
    getTranslations("Storefront.designer.header"),
    getStorefrontSummary(id),
    listAllProducts(),
    account
      ? getTraderIdentityStatus(account.accountId)
      : Promise.resolve({ ok: true as const, missing: [] }),
  ]);
  if (!storefront) notFound();

  return (
    <main className={pageShellClass}>
      <div className={pageColumnNarrowClass}>
        <BackLink href={STOREFRONT_LIST_PATH}>{tDesigner("back")}</BackLink>
        <PageHeader
          className="mb-6 mt-4 text-center"
          title={t("title")}
          subtitle={t("description", { name: storefront.name })}
        />
        <EmbedSettings
          storefront={storefront}
          products={products}
          missingTraderDetails={identity.ok ? identity.missing : []}
        />
      </div>
    </main>
  );
}
