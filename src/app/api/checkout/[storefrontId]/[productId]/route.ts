import { headers } from "next/headers";
import type { z } from "zod";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { turnstileEnabled, verifyTurnstile } from "@/lib/turnstile";
import { placeOrderSchema } from "@/lib/validation/checkout";
import { quoteCheckout } from "@/lib/checkout/quote";
import { checkoutAvailableFor, checkoutProviderFor } from "@/lib/checkout/availability";
import { placeOrder } from "@/lib/checkout/provider";
import { orderLinkPath } from "@/lib/orders/order-link";
import { PLACED_QUERY_PARAM } from "@/lib/storefront/product-page-url";
import type { CheckoutErrorCode, PlaceOrderResponse } from "@/types/checkout";

/**
 * POST /api/checkout/[storefrontId]/[productId]: place an order from the
 * hosted checkout.
 *
 * A route handler rather than a server action, deliberately: a buyer's tab
 * can sit open across a deploy, and a server action's id does not survive
 * one ("Failed to find Server Action"). A plain URL does.
 *
 * PUBLIC, and the one public write that starts a payment, so it is paid for in
 * this order before anything is decided:
 *
 *   1. Same origin only (lib/security/same-origin.ts): another site's page
 *      cannot place an order through a buyer's browser.
 *   2. A bounded body, parsed strictly (lib/validation/checkout.ts). It can
 *      name a version, a quantity, an address; it cannot name a price.
 *   3. The client IP spends a token from the checkoutPlace budget (small, and
 *      fail-closed): where card testing would aim, this is what it hits.
 *   4. Turnstile, when this deployment has it configured.
 *   5. THE QUOTE (lib/checkout/quote.ts), behind the product page's own gate,
 *      re-reads price, stock, options and delivery from the database. It is
 *      the only source of the amount a provider is handed.
 *   6. The provider takes the payment and the order writer records it.
 *
 * The answer is the buyer's order page (a credential, see
 * lib/orders/order-link.ts) or a reason the checkout can put into words.
 */

type Params = { storefrontId: string; productId: string };

/** Far more than any honest order body (a long address and a gift message are
 *  well under 2 KB); anything bigger is not read. */
const BODY_MAX_BYTES = 8 * 1024;
/** A Turnstile token's upper bound, with room to spare. */
const TURNSTILE_TOKEN_MAX = 2048;

function answer(body: PlaceOrderResponse, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function refuse(error: CheckoutErrorCode, status: number, fields?: string[]): Response {
  return answer({ ok: false, error, ...(fields && fields.length > 0 ? { fields } : {}) }, status);
}

/** The form's own field names for a failed parse, so it can mark them. */
function fieldsOf(issues: z.core.$ZodIssue[]): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    const [first, second] = issue.path;
    const name = first === "shipTo" && typeof second === "string" ? second : first;
    if (typeof name === "string") names.add(name);
  }
  return [...names];
}

export async function POST(request: Request, { params }: { params: Promise<Params> }) {
  if (!isSameOriginRequest(request)) return refuse("unavailable", 403);

  const read = await readBoundedJson(request, BODY_MAX_BYTES);
  if (!read.ok) return refuse("invalid", read.reason === "too_large" ? 413 : 400);
  const json = read.value;
  if (typeof json !== "object" || json === null || Array.isArray(json)) return refuse("invalid", 400);

  // The Turnstile token rides beside the order, not in it: it is spent here and
  // never reaches the schema, the quote or the writer.
  const { turnstileToken, ...body } = json as Record<string, unknown>;
  const parsed = placeOrderSchema.safeParse(body);
  if (!parsed.success) return refuse("invalid", 400, fieldsOf(parsed.error.issues));
  const order = parsed.data;

  const { storefrontId, productId } = await params;
  const ip = await clientKey(await headers());
  if (!(await rateLimitKey(ip, "checkout_place", RATE_LIMITS.checkoutPlace))) {
    return refuse("rate_limited", 429);
  }
  if (turnstileEnabled()) {
    const token =
      typeof turnstileToken === "string" && turnstileToken.length <= TURNSTILE_TOKEN_MAX ? turnstileToken : "";
    if (!(await verifyTurnstile(token, ip))) return refuse("invalid", 400, ["turnstile"]);
  }

  const quoted = await quoteCheckout(
    {
      storefrontId,
      productId,
      optionIds: order.optionIds,
      quantity: order.quantity,
      country: order.shipTo?.country ?? null,
    },
    // The gate spends from the checkout PAGE budget: the place budget above is
    // already spent, and a buyer who has just loaded the page is well within
    // this one.
    { action: "checkout_page", budget: RATE_LIMITS.checkoutPage },
  );
  if (!quoted.ok) {
    return refuse(quoted.reason, quoted.reason === "not_found" ? 404 : 409);
  }
  const { quote } = quoted;

  // Checkout must still be open for this product: a provider can take the
  // money, and delivery is priced. The page asked the same question when it
  // rendered; the answer can change between the two.
  const provider = checkoutProviderFor(quote.gate.ownerId);
  if (!provider || !checkoutAvailableFor(quote.gate)) return refuse("unavailable", 409);

  // What the kind of product demands of the body. A parcel needs an address;
  // a download needs the buyer's consent to have it straight away (and gives
  // up the right to withdraw once it starts, CRD art. 16(m)), which must be an
  // active choice, never assumed.
  if (!quote.isDigital && !order.shipTo) return refuse("invalid", 400, ["shipTo"]);
  if (quote.isDigital && order.supplyConsent !== true) return refuse("consent", 400, ["consent"]);

  const placed = await placeOrder(
    provider,
    quote,
    {
      email: order.email,
      locale: order.locale,
      shipTo: quote.isDigital ? null : (order.shipTo ?? null),
      giftMessage: quote.isDigital ? null : (order.giftMessage ?? null),
      supplyConsent: quote.isDigital && order.supplyConsent === true,
    },
    order.attemptId,
  );
  if (!placed.ok) return refuse(placed.reason, placed.reason === "unavailable" ? 409 : 502);

  const path = await orderLinkPath(storefrontId, placed.orderId);
  if (!path) return refuse("failed", 500);
  return answer({ ok: true, orderUrl: `${path}?${PLACED_QUERY_PARAM}=1` }, 201);
}
