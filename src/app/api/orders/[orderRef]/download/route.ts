import { headers } from "next/headers";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { presignDownloadUrl } from "@/lib/r2";
import { readOrderByRef } from "@/lib/orders/order-page";
import { createAdminClient } from "@/lib/supabase/admin";
import { isContentVisible } from "@/lib/moderation/removal";

/**
 * GET /api/orders/[orderRef]/download: the file a buyer paid for.
 *
 * The order page's button and the confirmation email both link HERE, never to
 * a signed storage URL: a signed URL in an inbox is a file anyone who sees the
 * email can fetch for as long as it lives. This route re-proves the order on
 * every click (its credential, lib/orders/order-link.ts), checks it is PAID and
 * is a download, and only then mints a link that lives for minutes and makes
 * the browser save the file (lib/r2.ts presignDownloadUrl).
 *
 * The file is the one SNAPSHOTTED on the order when it was paid for, so a
 * seller replacing the product's file, or deleting the product, never takes a
 * buyer's purchase away.
 *
 * It also stops serving when the buyer has withdrawn from the purchase (the
 * contract is over, and so is the file), and when moderation has taken the
 * PRODUCT down: a removal for content that must not circulate has to stop the
 * file reaching earlier buyers too, or the takedown is a takedown in name only.
 * A deleted product (no row left) is not a takedown, so its buyers keep theirs.
 *
 * Every refusal is the same 404.
 */

type Params = { orderRef: string };

const NOT_FOUND = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<Params> }) {
  const key = await clientKey(await headers());
  if (!(await rateLimitKey(key, "order_download", RATE_LIMITS.orderDownload))) {
    return new Response("Too many requests", { status: 429, headers: { "cache-control": "no-store" } });
  }

  const { orderRef } = await params;
  const order = await readOrderByRef(orderRef);
  if (!order || order.status !== "paid" || !order.digital_file_key) return NOT_FOUND();
  if (order.withdrawal_requested_at) return NOT_FOUND();
  if (order.product_id) {
    const { data: product, error } = await createAdminClient()
      .from("products")
      .select("moderation_status")
      .eq("id", order.product_id)
      .maybeSingle();
    // Fail closed: a product we could not read might be one that was removed.
    if (error) return NOT_FOUND();
    if (product && !isContentVisible(product.moderation_status)) return NOT_FOUND();
  }

  // A clean name for the saved file: the product's title and the stored file's
  // own extension. The key itself never reaches the buyer.
  const extension = order.digital_file_key.split(".").pop() ?? "";
  const safeExtension = /^[A-Za-z0-9]{1,5}$/.test(extension) ? `.${extension.toLowerCase()}` : "";
  const url = await presignDownloadUrl(order.digital_file_key, `${order.product_title}${safeExtension}`);
  if (!url) return NOT_FOUND();

  return new Response(null, {
    status: 302,
    headers: { location: url, "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
