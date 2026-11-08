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
import { getStorefrontSummary, listEmbedDomains } from "@/lib/storefront/queries";
import { embedDomainsElsewhere } from "@/lib/predictions";
import { placedProductIds } from "@/lib/storefront/placed-products";
import { STOREFRONT_LIST_PATH } from "@/lib/storefront/paths";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getTraderIdentityStatus, getSellerIdentity } from "@/lib/settings/seller-identity";
import { storefrontDisplayName } from "@/lib/storefront/display-name";
import type { EmbedLink } from "@/lib/storefront/embed-snippet";

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

  const [t, tDesigner, tButton, storefront, products, identity, embedDomains, sellerIdentity] = await Promise.all([
    getTranslations("Storefront.embed"),
    getTranslations("Storefront.designer.header"),
    getTranslations("Products.buyButton"),
    getStorefrontSummary(id),
    listStorefrontProducts(),
    account
      ? getTraderIdentityStatus(account.accountId)
      : Promise.resolve({ ok: true as const, missing: [] }),
    listEmbedDomains(),
    // The trader's name, which the hosted page puts first (embedLink below).
    account ? getSellerIdentity(account.accountId) : Promise.resolve({}),
  ]);
  if (!storefront) notFound();
  // The hero draws this storefront's own products; the rest of the catalogue
  // has no business in the page.
  const placed = placedProductIds([storefront]);

  // Whether the storefront has a page of its own right now, by the same two
  // facts its public loader asks for (lib/storefront/storefront-page.ts). An
  // identity that could not be read withholds the link, like the page would.
  const productPage = resolveProductPage(storefront.config);
  const pageState = !productPage.enabled
    ? "pages-off"
    : identity.ok && identity.missing.length === 0
      ? "live"
      : "details-missing";
  // What is still owed, for both the link card's and the embed's way to Settings.
  const missingTraderDetails = identity.ok ? identity.missing : [];

  // The link the snippet carries for crawlers and visitors without scripts:
  // the hosted storefront, named as that page names itself
  // (storefrontDisplayName). Only while the page is live, which also means not
  // taken down by staff (the public loader's first refusal): a seller's site
  // must never link to a 404.
  const embedLink: EmbedLink | null =
    pageState === "live" && !storefront.removal
      ? {
          url: storefrontPageUrl(storefront.id),
          label: storefrontDisplayName({
            seller: sellerIdentity,
            header: storefront.config.header,
            name: storefront.name,
          }),
        }
      : null;

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
          searchable={productPage.allowIndexing}
          missing={missingTraderDetails}
        />
        <EmbedSettings
          storefront={storefront}
          products={products.filter((product) => placed.has(product.id))}
          missingTraderDetails={missingTraderDetails}
          productPagesOn={pageState !== "pages-off"}
          suggestedDomains={embedDomainsElsewhere(embedDomains, storefront.id)}
          link={embedLink}
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
