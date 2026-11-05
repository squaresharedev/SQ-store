import { optionIdsForSelection, parseOrderSelection } from "@/lib/orders/selection";
import { parseOptionGroups } from "@/lib/products/detail";
import { headers } from "next/headers";
import { appUrl } from "@/lib/app-url";
import { StripeApiError, stripeRequest } from "@/lib/billing/stripe-api";
import { CHECKOUT_CANCEL_PARAM } from "@/lib/checkout/paths";
import { releasePendingOrder } from "@/lib/orders/record";
import { readPaymentAccount } from "@/lib/payments/connect/account";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { checkoutPath, type AddOnPick } from "@/lib/storefront/product-page-url";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/checkout/cancel?c=<checkout id>: where a buyer lands when they back
 * out of the payment page.
 *
 * WHY IT IS A ROUTE AND NOT JUST A LINK BACK. The order they left behind is
 * holding its stock (lib/orders/record.ts reservePendingOrder), and would keep
 * holding it until the payment page expires half an hour later. For the last
 * one of something, that is a buyer who changed their mind about the gift note
 * being told "sold out" by their own abandoned attempt. So the page is CLOSED
 * first, and only then are the units given back.
 *
 * IN THAT ORDER, because the other one sells the same item twice: a released
 * order whose payment page is still open in another tab can still be paid.
 * Stripe guarantees an expired session cannot. If it will not expire (it was
 * paid a moment ago, or Stripe cannot be reached) nothing is released: the
 * payment event, or the sweep, settles it.
 *
 * NO SESSION, like every buyer route. The checkout id is the capability: 128
 * random bits minted for one buyer's page. And nothing here can be pointed
 * anywhere: the way back is built from the order's own storefront and
 * product, never taken from the request.
 */
export const dynamic = "force-dynamic";

/** The checkout ids lib/checkout/stripe-provider.ts mints. */
const CHECKOUT_ID = /^cs_ss_[0-9a-f]{32}$/;

const gone = () => new Response(null, { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const checkoutSessionId = new URL(request.url).searchParams.get(CHECKOUT_CANCEL_PARAM) ?? "";
  if (!CHECKOUT_ID.test(checkoutSessionId)) return gone();

  const ip = await clientKey(await headers());
  if (!(await rateLimitKey(ip, "checkout_page", RATE_LIMITS.checkoutPage))) return gone();

  const { data: order, error } = await createAdminClient()
    .from("orders")
    .select("id, seller_id, storefront_id, product_id, status, payment_ref, selected_options, quantity")
    .eq("checkout_session_id", checkoutSessionId)
    .maybeSingle();
  if (error) console.error("[checkout] cancel could not read the order:", error.message);
  if (!order?.storefront_id || !order.product_id) return gone();

  // What was added to the order, read BEFORE the release below deletes the
  // order with its lines, so the buyer goes back to the order they were paying.
  const { data: addOnLines } = await createAdminClient()
    .from("order_add_ons")
    .select("product_id, selected_options, position")
    .eq("order_id", order.id)
    .order("position", { ascending: true });

  if (order.status === "pending" && order.payment_ref?.startsWith("cs_")) {
    try {
      const account = await readPaymentAccount(order.seller_id);
      if (account) {
        await stripeRequest("POST", `/checkout/sessions/${order.payment_ref}/expire`, {}, { account: account.stripeAccountId });
        await releasePendingOrder(checkoutSessionId);
      }
    } catch (failure) {
      // Paid already, or Stripe unreachable: leave the order exactly as it is.
      const detail = failure instanceof StripeApiError ? failure.code ?? failure.type : String(failure);
      console.warn("[checkout] payment page could not be closed on cancel:", detail);
    }
  }

  // Back to the same checkout, with the version and quantity the buyer chose:
  // without them a product with options bounced them to its page to choose
  // again, and everything they had typed was gone with it.
  const choice = await choiceOf(order.product_id, order.selected_options, order.quantity);
  const addOns = await addOnsOf(addOnLines ?? []);
  return Response.redirect(appUrl(checkoutPath(order.storefront_id, order.product_id, { ...choice, addOns })), 303);
}

/** The add-ons of the order, as the checkout link carries them. A line whose
 *  version can no longer be named goes back without one, and the checkout
 *  then takes the first available version, as the product page would. */
async function addOnsOf(
  lines: readonly { product_id: string | null; selected_options: unknown }[],
): Promise<AddOnPick[]> {
  const ids = lines.flatMap((line) => (line.product_id ? [line.product_id] : []));
  if (ids.length === 0) return [];
  const { data: products } = await createAdminClient()
    .from("products")
    .select("id, option_groups")
    .in("id", ids);
  const groupsOf = new Map((products ?? []).map((row) => [row.id, parseOptionGroups(row.option_groups)]));
  return ids.map((productId, index) => ({
    productId,
    optionIds: optionIdsForSelection(
      groupsOf.get(productId) ?? [],
      parseOrderSelection(lines[index]?.selected_options),
    ),
  }));
}

/** The option ids and quantity of the order, as the checkout link carries
 *  them. Best effort: an unreadable product just means no preselection. */
async function choiceOf(
  productId: string,
  selectedOptions: unknown,
  quantity: number | null,
): Promise<{ optionIds: string[]; quantity?: number }> {
  const selection = parseOrderSelection(selectedOptions);
  const amount = quantity && quantity > 1 ? { quantity } : {};
  if (selection.length === 0) return { optionIds: [], ...amount };
  const { data: product, error } = await createAdminClient()
    .from("products")
    .select("option_groups")
    .eq("id", productId)
    .maybeSingle();
  if (error || !product) return { optionIds: [], ...amount };
  return { optionIds: optionIdsForSelection(parseOptionGroups(product.option_groups), selection), ...amount };
}
