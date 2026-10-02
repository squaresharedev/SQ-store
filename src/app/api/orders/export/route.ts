import { getTranslations } from "next-intl/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { getAccountBilling } from "@/lib/billing/account-plan";
import { planHas } from "@/lib/billing/features";
import { CSV_CONTENT_TYPE } from "@/lib/format/csv";
import { listOrdersForExport } from "@/lib/orders/queries";
import {
  ORDERS_EXPORT_MAX_ROWS,
  ORDERS_EXPORT_TRUNCATED_HEADER,
  ordersCsv,
  ordersCsvFileName,
} from "@/lib/orders/csv";

/**
 * GET /api/orders/export: the ACTIVE store's orders as a CSV file
 * (lib/orders/csv.ts), for its bookkeeping. A paid-plan perk.
 *
 * THE CHECKS, in order:
 *   - a signed-in member of the store (getActiveAccount re-validates the
 *     active-account cookie against a live membership);
 *   - `store.read`, the same permission the Orders page itself needs, so the
 *     file never shows anyone more than the page would;
 *   - the store's plan has the perk (a plan read that fails refuses, rather
 *     than guessing a plan);
 *   - the rate limit, before the heavy read.
 *
 * The store id comes from the session, never the request; the query scopes on
 * it and RLS enforces the same boundary underneath.
 *
 * The button (components/orders/OrdersExportButton) fetches this and saves
 * the file itself, so an error comes back as JSON it can show in place.
 *
 * force-dynamic: a Route Handler sits outside the (dashboard) layout's auth
 * gate and reads cookies, so it must never be cached or prerendered.
 */
export const dynamic = "force-dynamic";

function refuse(status: number, error: string, fix?: string): Response {
  return Response.json({ error, fix }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(): Promise<Response> {
  const t = await getTranslations("Errors.ordersExport");
  const account = await getActiveAccount();
  if (!account) return refuse(401, t("signIn"));
  if (!can(account.role, "store.read")) return refuse(403, t("permissionDenied"));

  const billing = await getAccountBilling(account.accountId);
  if (!billing.ok) return refuse(503, t("unavailable"), t("tryAgain"));
  if (!planHas(billing.billing.plan, "ordersExport")) {
    return refuse(402, t("planRequired"), t("planRequiredFix"));
  }

  if (!(await rateLimit("orders_export", RATE_LIMITS.ordersExport))) {
    return refuse(429, t("rateLimited"), t("rateLimitedFix"));
  }

  let result: Awaited<ReturnType<typeof listOrdersForExport>>;
  try {
    result = await listOrdersForExport(ORDERS_EXPORT_MAX_ROWS);
  } catch (error) {
    console.error("[orders-export]", error instanceof Error ? error.message : String(error));
    return refuse(500, t("unavailable"), t("tryAgain"));
  }

  const headers: Record<string, string> = {
    "Content-Type": CSV_CONTENT_TYPE,
    "Content-Disposition": `attachment; filename="${ordersCsvFileName(new Date())}"`,
    // Customer data: never kept by a shared cache or the browser's.
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (result.truncated) headers[ORDERS_EXPORT_TRUNCATED_HEADER] = String(ORDERS_EXPORT_MAX_ROWS);
  return new Response(ordersCsv(result.rows), { status: 200, headers });
}
