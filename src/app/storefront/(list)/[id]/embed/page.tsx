import Link from "@/components/ui/AppLink";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { cardClass, pageColumnClass, pageShellClass } from "@/components/ui/surface-styles";
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
import { placedProductIds } from "@/lib/storefront/placed-products";
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
  // The hero draws this storefront's own products; the rest of the catalogue
  // has no business in the page.
  const placed = placedProductIds([storefront]);

  // Whether the storefront has a page of its own right now, by the same two
  // facts its public loader asks for (lib/storefront/storefront-page.ts). An
  // identity that could not be read withholds the link, like the page would.
  const pageState = !resolveProductPage(storefront.config).enabled
    ? "pages-off"
    : identity.ok && identity.missing.length === 0
      ? "live"
      : "details-missing";

  return (
    // A page like the others in the dashboard, from its left edge: back link,
    // title, then the work, capped so the fields stay a readable width.
    <main className={cn(pageShellClass, "space-y-6")}>
      <BackLink href={STOREFRONT_LIST_PATH}>{tDesigner("back")}</BackLink>
      <PageHeader title={t("title")} subtitle={t("description", { name: storefront.name })} />
      <div className={cn(pageColumnClass, "space-y-6")}>
        {/* The storefront as a page of its own: no website needed. First on
            the page, because it is the way to share that works today, and
            the one a seller who asked "how do I share my store?" is after. */}
        <StorefrontLinkCard
          storefrontId={storefront.id}
          url={storefrontPageUrl(storefront.id)}
          state={pageState}
        />
        <EmbedSettings
          storefront={storefront}
          products={products.filter((product) => placed.has(product.id))}
          missingTraderDetails={identity.ok ? identity.missing : []}
          productPagesOn={pageState !== "pages-off"}
        />
        {/* The other way onto a seller's own site, for someone selling one
            product: the buy button lives on the product, so this points there.
            Last, as a footnote: the link above is what most sellers came for. */}
        <aside className={cn(cardClass, "flex flex-wrap items-center justify-between gap-3 p-4")}>
          <p className={helpTextClass}>{tButton("embedPointer")}</p>
          <Link href={PRODUCTS_PATH} className={bannerActionClass}>
            {tButton("embedPointerLink")}
            <ArrowRight className={cn("size-3.5", iconNudgeRightClass)} strokeWidth={2} aria-hidden />
          </Link>
        </aside>
      </div>
    </main>
  );
}
