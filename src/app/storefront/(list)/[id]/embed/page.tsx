import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { cardClass, pageColumnNarrowClass, pageShellClass } from "@/components/ui/surface-styles";
import { bannerActionClass, helpTextClass, iconNudgeRightClass } from "@/components/ui/control-styles";
import { PRODUCTS_PATH } from "@/lib/products/paths";
import { BackLink } from "@/components/ui/BackLink";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmbedSettings } from "@/components/storefront/EmbedSettings";
import { StorefrontLinkCard } from "@/components/storefront/StorefrontLinkCard";
import { resolveProductPage } from "@/lib/storefront/product-page";
import { storefrontPageUrl } from "@/lib/storefront/product-page-url";
import { listStorefrontProducts } from "@/lib/discounts/storefront-preview";
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

  const [t, tDesigner, tButton, storefront, products, identity] = await Promise.all([
    getTranslations("Storefront.embed"),
    getTranslations("Storefront.designer.header"),
    getTranslations("Products.buyButton"),
    getStorefrontSummary(id),
    listStorefrontProducts(),
    account
      ? getTraderIdentityStatus(account.accountId)
      : Promise.resolve({ ok: true as const, missing: [] }),
  ]);
  if (!storefront) notFound();

  // Whether the storefront has a page of its own right now, by the same two
  // facts its public loader asks for (lib/storefront/storefront-page.ts). An
  // identity that could not be read withholds the link, like the page would.
  const pageState = !resolveProductPage(storefront.config).enabled
    ? "pages-off"
    : identity.ok && identity.missing.length === 0
      ? "live"
      : "details-missing";

  return (
    <main className={pageShellClass}>
      <div className={pageColumnNarrowClass}>
        <BackLink href={STOREFRONT_LIST_PATH}>{tDesigner("back")}</BackLink>
        <PageHeader
          className="mb-6 mt-4 text-center"
          title={t("title")}
          subtitle={t("description", { name: storefront.name })}
        />
        {/* The other way onto a seller's own site, for someone selling one
            product: the buy button lives on the product, so this points there.
            First on the page, because that seller should not have to read
            the whole embed setup to learn they do not need it. */}
        <aside className={cn(cardClass, "mb-5 flex flex-wrap items-center justify-between gap-3 p-4")}>
          <p className={helpTextClass}>{tButton("embedPointer")}</p>
          <Link href={PRODUCTS_PATH} className={bannerActionClass}>
            {tButton("embedPointerLink")}
            <ArrowRight className={cn("size-3.5", iconNudgeRightClass)} strokeWidth={2} aria-hidden />
          </Link>
        </aside>
        {/* The storefront as a page of its own: no website needed. Above the
            embed setup, because it is the way to share that works today. */}
        <div className="mb-5">
          <StorefrontLinkCard
            storefrontId={storefront.id}
            url={storefrontPageUrl(storefront.id)}
            state={pageState}
          />
        </div>
        <EmbedSettings
          storefront={storefront}
          products={products}
          missingTraderDetails={identity.ok ? identity.missing : []}
          productPagesOn={pageState !== "pages-off"}
        />
      </div>
    </main>
  );
}
