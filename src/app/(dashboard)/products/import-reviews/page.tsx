import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseDetails } from "@/lib/products/detail";
import { PRODUCTS_PATH } from "@/lib/products/paths";
import { REVIEWS_IMPORT_PATH } from "@/lib/reviews/paths";
import { ghostButtonClass } from "@/components/ui/control-styles";
import { ReviewImport } from "@/components/products/ReviewImport";
import type { MatchableProduct } from "@/lib/reviews/import";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Products.metadata.importReviews");
  return { title: t("title") };
}

/** More than any plan holds, so every product is offered for matching. */
const PRODUCTS_READ_MAX = 2000;

// PROTECTED by (dashboard)/layout.tsx, and gated to writers like
// /products/import: importing reviews writes to the store's products.
export default async function ImportReviewsPage() {
  await requireUser(REVIEWS_IMPORT_PATH);
  const account = await getActiveAccount();
  if (!account || !can(account.role, "products.write")) redirect(PRODUCTS_PATH);

  // The store's products, for matching the file's products to. Through RLS:
  // the member's own view of the store.
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, title, details")
    .eq("owner_id", account.accountId)
    .order("title")
    .limit(PRODUCTS_READ_MAX);
  const products: MatchableProduct[] = (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    identifier: parseDetails(row.details).safety?.identifier ?? null,
  }));

  const t = await getTranslations("Products.page");

  return (
    <div className="@container mx-auto w-full max-w-3xl space-y-6 p-4 @md:p-6">
      <div className="space-y-3">
        <Link href={PRODUCTS_PATH} className={ghostButtonClass}>
          <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
          {t("back")}
        </Link>
        <div>
          <h1 className="font-inter text-2xl font-semibold text-foreground">{t("importReviews.heading")}</h1>
          <p className="mt-1 font-inter text-sm text-muted-foreground">{t("importReviews.description")}</p>
        </div>
      </div>
      <ReviewImport products={products} />
    </div>
  );
}
