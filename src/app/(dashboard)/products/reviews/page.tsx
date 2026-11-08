import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "@/components/ui/AppLink";
import { ArrowLeft, Eye } from "lucide-react";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { requireUser } from "@/lib/auth/session";
import { PRODUCTS_PATH } from "@/lib/products/paths";
import { REVIEWS_IMPORT_PATH, REVIEWS_PATH } from "@/lib/reviews/paths";
import { parseSellerReviewFilters } from "@/lib/reviews/seller-filters";
import { getSellerReviewOverview, getSellerReviews } from "@/lib/reviews/seller-queries";
import { getPrimaryStorefrontId } from "@/lib/storefront/queries";
import { PRODUCT_PAGE_REVIEWS_SETTING_ID, settingHref } from "@/lib/storefront/setting-ref";
import { ghostButtonClass, quietIconLinkClass, secondaryButtonClass } from "@/components/ui/control-styles";
import { pageSubtitleClass } from "@/components/ui/surface-styles";
import { UploadIcon } from "@/components/ui/UploadIcon";
import { cn } from "@/lib/utils";
import { ReviewModeration } from "@/components/products/ReviewModeration";
import { ReviewsExportButton } from "@/components/products/ReviewsExportButton";

/** The header's buttons (export and import), sized as one pair. */
const headerButtonClass = "h-10 shrink-0 px-3 py-2 text-sm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Products.metadata.reviews");
  return { title: t("title") };
}

type SearchParams = Record<string, string | string[] | undefined>;

// PROTECTED by (dashboard)/layout.tsx. Every member of the store can read its
// reviews; only those who may edit products can hide, show or publish them
// (the action and review_set_visibility both check).
export default async function ReviewsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireUser(REVIEWS_PATH);
  const account = await getActiveAccount();
  if (!account || !can(account.role, "store.read")) redirect(PRODUCTS_PATH);

  const { filters, page } = parseSellerReviewFilters(await searchParams);

  const [list, overview, t, tPage, storefrontId] = await Promise.all([
    getSellerReviews(account.accountId, filters, page),
    getSellerReviewOverview(account.accountId),
    getTranslations("Products.reviewModeration"),
    getTranslations("Products.page"),
    // Whether buyers see reviews is the product page's switch, in the
    // designer: offered on the storefront edited last, to those who may edit
    // it. A failed read only costs the link.
    can(account.role, "storefront.write") ? getPrimaryStorefrontId().catch(() => null) : null,
  ]);

  return (
    <div className="@container mx-auto w-full max-w-4xl space-y-6 p-4 @md:p-6">
      <div className="space-y-3">
        <Link href={PRODUCTS_PATH} className={ghostButtonClass}>
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          {tPage("back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-inter text-2xl font-semibold text-foreground">{t("heading")}</h1>
            <p className={pageSubtitleClass}>{t("description")}</p>
            {storefrontId && (
              <Link
                href={settingHref(PRODUCT_PAGE_REVIEWS_SETTING_ID, storefrontId)}
                className={cn(quietIconLinkClass, "mt-2")}
              >
                <Eye className="size-3.5" strokeWidth={2} aria-hidden="true" />
                {t("productPageLink")}
              </Link>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {/* Everyone who can read the reviews can take them away in a
                file, of whatever the list is showing. */}
            {list && <ReviewsExportButton filters={filters} count={list.total} className={headerButtonClass} />}
            {/* A button, like Import on Products: someone arriving with reviews
                elsewhere is looking for exactly this. */}
            {can(account.role, "products.write") && (
              <Link href={REVIEWS_IMPORT_PATH} className={cn(secondaryButtonClass, headerButtonClass)}>
                <UploadIcon className="size-4" />
                {t("importButton")}
              </Link>
            )}
          </div>
        </div>
      </div>
      <ReviewModeration
        list={list}
        overview={overview}
        filters={filters}
        canModerate={can(account.role, "products.write")}
      />
    </div>
  );
}
