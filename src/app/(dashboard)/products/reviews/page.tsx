import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "@/components/ui/AppLink";
import { ArrowLeft } from "lucide-react";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { requireUser } from "@/lib/auth/session";
import { PRODUCTS_PATH } from "@/lib/products/paths";
import { REVIEWS_IMPORT_PATH, REVIEWS_PATH } from "@/lib/reviews/paths";
import { parseSellerReviewFilters } from "@/lib/reviews/seller-filters";
import { getSellerReviewOverview, getSellerReviews } from "@/lib/reviews/seller-queries";
import { ghostButtonClass, quietLinkClass } from "@/components/ui/control-styles";
import { ReviewModeration } from "@/components/products/ReviewModeration";

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

  const [list, overview, t, tPage] = await Promise.all([
    getSellerReviews(account.accountId, filters, page),
    getSellerReviewOverview(account.accountId),
    getTranslations("Products.reviewModeration"),
    getTranslations("Products.page"),
  ]);

  return (
    <div className="@container mx-auto w-full max-w-4xl space-y-6 p-4 @md:p-6">
      <div className="space-y-3">
        <Link href={PRODUCTS_PATH} className={ghostButtonClass}>
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          {tPage("back")}
        </Link>
        <div>
          <h1 className="font-inter text-2xl font-semibold text-foreground">{t("heading")}</h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">{t("description")}</p>
          {can(account.role, "products.write") && (
            <Link href={REVIEWS_IMPORT_PATH} className={`${quietLinkClass} mt-2 inline-block`}>
              {t("importLink")}
            </Link>
          )}
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
