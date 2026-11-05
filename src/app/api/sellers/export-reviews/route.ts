import { getTranslations } from "next-intl/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { RATE_LIMITS, rateLimit, rateLimitKey } from "@/lib/rate-limit";
import { CSV_CONTENT_TYPE } from "@/lib/format/csv";
import { REVIEW_EXPORT_ROWS_MAX } from "@/lib/reviews/limits";
import { parseSellerReviewFilters } from "@/lib/reviews/seller-filters";
import { sellerReviewsForExport } from "@/lib/reviews/seller-queries";
import { REVIEWS_EXPORT_TRUNCATED_HEADER, reviewsCsv, reviewsCsvFileName, type ReviewsCsv } from "@/lib/reviews/export";

/**
 * GET /api/sellers/export-reviews: one view of the ACTIVE store's reviews as
 * a CSV file (lib/reviews/export.ts). The query string is the reviews page's
 * own (tab, search, rating, product, source, sort), read by the same parser,
 * so the file holds what the list shows, every page of it. Anything it does
 * not recognise is dropped, as on the page.
 *
 * THE CHECKS, in order:
 *   - a signed-in member of the store (getActiveAccount re-validates the
 *     active-account cookie against a live membership);
 *   - `store.read`, the permission the reviews page itself needs, so the file
 *     never shows anyone more than the page would;
 *   - the member's own budget, then the store's across its team, both before
 *     the read.
 *
 * The store id comes from the session, never the request; the query scopes on
 * it and RLS (reviews_select_member) enforces the same boundary underneath.
 *
 * The button (components/products/ReviewsExportButton) fetches this and saves
 * the file itself, so an error comes back as JSON it can show in place.
 *
 * force-dynamic: a Route Handler sits outside the (dashboard) layout's auth
 * gate and reads cookies, so it must never be cached or prerendered.
 */
export const dynamic = "force-dynamic";

function refuse(status: number, error: string, fix?: string): Response {
  return Response.json({ error, fix }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const t = await getTranslations("Errors");
  const account = await getActiveAccount();
  if (!account) return refuse(401, t("sessionExpired.message"), t("sessionExpired.fix"));
  if (!can(account.role, "store.read")) return refuse(403, t("reviewsExport.permissionDenied"));

  if (!(await rateLimit("reviews_export", RATE_LIMITS.reviewsExport))) {
    return refuse(429, t("reviewsExport.rateLimited"), t("rateLimited.fix"));
  }
  if (!(await rateLimitKey(account.accountId, "reviews_export_store", RATE_LIMITS.reviewsExportPerStore))) {
    return refuse(429, t("reviewsExport.storeRateLimited"), t("rateLimited.fix"));
  }

  const { filters } = parseSellerReviewFilters(Object.fromEntries(new URL(request.url).searchParams));

  let file: ReviewsCsv;
  try {
    // One past the cap, so a view of exactly the cap is not called cut short.
    file = await reviewsCsv(sellerReviewsForExport(account.accountId, filters, REVIEW_EXPORT_ROWS_MAX + 1));
  } catch (error) {
    console.error("[reviews-export]", error instanceof Error ? error.message : String(error));
    return refuse(500, t("reviewsExport.unavailable"), t("serverError.fix"));
  }

  const headers: Record<string, string> = {
    "Content-Type": CSV_CONTENT_TYPE,
    "Content-Disposition": `attachment; filename="${reviewsCsvFileName(new Date())}"`,
    // What buyers wrote, including reviews nobody may publish: never kept by
    // a shared cache or the browser's.
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (file.truncated) headers[REVIEWS_EXPORT_TRUNCATED_HEADER] = String(file.rows);
  return new Response(file.csv, { status: 200, headers });
}
