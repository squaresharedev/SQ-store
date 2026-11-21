// SERVER ONLY. PLACING AN ORDER from the hosted checkout: the one public write
// that starts a payment. Shared by both order routes, "Buy now"
// (app/api/checkout/[storefrontId]/[productId]) and the cart
// (app/api/checkout/[storefrontId]), which differ only in how their body names
// the lines. Everything is paid for in this order before anything is decided:
//
//   1. Same origin only (lib/security/same-origin.ts): another site's page
//      cannot place an order through a buyer's browser.
//   2. A bounded body, parsed strictly (lib/validation/checkout.ts). It can
//      name versions, quantities, an address; it cannot name a price.
//   3. The client IP spends a token from the checkoutPlace budget (small, and
//      fail-closed): where card testing would aim, this is what it hits.
//   4. Turnstile, when this deployment has it configured.
//   5. THE QUOTE (lib/checkout/quote.ts), behind the product page's own gate,
//      re-reads price, stock, options, delivery and any discount from the
//      database, for every line. It is the only source of the amount a
//      provider is handed.
//   6. The total the buyer was shown, when the page sends it, must be the
//      quote's total. A sale that ended (or a price that changed) between the
//      page loading and Pay is answered with `price_changed`, never charged.
//   7. The provider takes the payment and the order writer records it.
//
// The answer is the buyer's order page (a credential, see
// lib/orders/order-link.ts) or a reason the checkout can put into words.

import { headers } from "next/headers";
import type { z } from "zod";
import { RATE_LIMITS, clientKey, rateLimitKey } from "@/lib/rate-limit";
import { isSameOriginRequest } from "@/lib/security/same-origin";
import { readBoundedJson } from "@/lib/security/read-json";
import { turnstileEnabled, verifyTurnstile } from "@/lib/turnstile";
import { quoteOrder, type QuoteLineInput, type QuoteRefusal } from "@/lib/checkout/quote";
import { checkoutProviderFor } from "@/lib/checkout/availability";
import { placeOrder } from "@/lib/checkout/provider";
import { orderLinkPath } from "@/lib/orders/order-link";
import { PLACED_QUERY_PARAM } from "@/lib/storefront/product-page-url";
import type { PlaceOrderInput } from "@/lib/validation/checkout";
import type { CheckoutErrorCode, PlaceOrderResponse } from "@/types/checkout";

/** A Turnstile token's upper bound, with room to spare. */
const TURNSTILE_TOKEN_MAX = 2048;

/** What every order body says about the buyer, whatever is being bought. */
export type OrderBuyerBody = Pick<
  PlaceOrderInput,
  | "attemptId"
  | "email"
  | "locale"
  | "shipTo"
  | "giftMessage"
  | "supplyConsent"
  | "channel"
  | "discountCode"
  | "expectedTotalCents"
>;

/** A route's reading of its body: the lines, the buyer, and the cart. */
export type ParsedOrderBody =
  | { ok: true; lines: QuoteLineInput[]; order: OrderBuyerBody; cartId: string | null }
  | { ok: false; fields: string[] };

function answer(body: PlaceOrderResponse, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function refuse(error: CheckoutErrorCode, status: number, extra: { fields?: string[]; line?: number } = {}): Response {
  return answer(
    {
      ok: false,
      error,
      ...(extra.fields && extra.fields.length > 0 ? { fields: extra.fields } : {}),
      ...(extra.line !== undefined ? { line: extra.line } : {}),
    },
    status,
  );
}

/** The form's own field names for a failed parse, so it can mark them. */
export function fieldsOf(issues: z.core.$ZodIssue[]): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    const [first, second] = issue.path;
    const name = first === "shipTo" && typeof second === "string" ? second : first;
    if (typeof name === "string") names.add(name);
  }
  return [...names];
}

export async function placeOrderResponse(
  request: Request,
  input: {
    storefrontId: string;
    /** Far more than any honest body of this route's shape; anything bigger
     *  is not read. */
    bodyMaxBytes: number;
    parse: (body: Record<string, unknown>) => ParsedOrderBody;
    /** How a refusal reads to this route's page (Buy now names a problem with
     *  an "Add to your order" line its own way). */
    refusalFor?: (reason: QuoteRefusal, line: number | undefined) => CheckoutErrorCode;
  },
): Promise<Response> {
  if (!isSameOriginRequest(request)) return refuse("unavailable", 403);

  const read = await readBoundedJson(request, input.bodyMaxBytes);
  if (!read.ok) return refuse("invalid", read.reason === "too_large" ? 413 : 400);
  const json = read.value;
  if (typeof json !== "object" || json === null || Array.isArray(json)) return refuse("invalid", 400);

  // The Turnstile token rides beside the order, not in it: it is spent here and
  // never reaches the schema, the quote or the writer.
  const { turnstileToken, ...body } = json as Record<string, unknown>;
  const parsed = input.parse(body);
  if (!parsed.ok) return refuse("invalid", 400, { fields: parsed.fields });
  const { order, lines, cartId } = parsed;

  const requestHeaders = await headers();
  if (!(await rateLimitKey(await clientKey(requestHeaders), "checkout_place", RATE_LIMITS.checkoutPlace))) {
    return refuse("rate_limited", 429);
  }
  if (turnstileEnabled()) {
    const token =
      typeof turnstileToken === "string" && turnstileToken.length <= TURNSTILE_TOKEN_MAX ? turnstileToken : "";
    // The address itself, as sign-up sends it: clientKey is a rate-limit key.
    const remoteIp = requestHeaders.get("cf-connecting-ip") ?? undefined;
    if (!(await verifyTurnstile(token, remoteIp))) return refuse("invalid", 400, { fields: ["turnstile"] });
  }

  const quoted = await quoteOrder(
    {
      storefrontId: input.storefrontId,
      lines,
      country: order.shipTo?.country ?? null,
      discountCode: order.discountCode ?? null,
    },
    // The gate spends from the checkout PAGE budget: the place budget above is
    // already spent, and a buyer who has just loaded the page is well within
    // this one.
    { action: "checkout_page", budget: RATE_LIMITS.checkoutPage },
  );
  if (!quoted.ok) {
    const error = input.refusalFor ? input.refusalFor(quoted.reason, quoted.line) : quoted.reason;
    return refuse(error, quoted.reason === "not_found" && quoted.line === undefined ? 404 : 409, {
      line: quoted.line,
    });
  }
  const { quote } = quoted;

  // Only what the buyer saw is charged (CRD art. 6(1)(e) and 8(2)): the page
  // sends the total on its Pay button, and any difference is the buyer's to
  // see before anything is taken.
  if (order.expectedTotalCents !== undefined && order.expectedTotalCents !== quote.totalCents) {
    return refuse("price_changed", 409);
  }

  // A provider must still be able to take the money. (Whether delivery can be
  // priced was each line's own question in the quote.)
  const provider = await checkoutProviderFor(quote.store.ownerId);
  if (!provider) return refuse("unavailable", 409);

  // What the order's lines demand of the body. A parcel needs an address; a
  // download needs the buyer's consent to have it straight away (and gives up
  // the right to withdraw once it starts, CRD art. 16(m)), which must be an
  // active choice, never assumed. A cart can need both.
  if (quote.ships && !order.shipTo) return refuse("invalid", 400, { fields: ["shipTo"] });
  if (quote.hasDownloads && order.supplyConsent !== true) return refuse("consent", 400, { fields: ["consent"] });

  const placed = await placeOrder(
    provider,
    quote,
    {
      email: order.email,
      locale: order.locale,
      shipTo: quote.ships ? (order.shipTo ?? null) : null,
      giftMessage: quote.ships ? (order.giftMessage ?? null) : null,
      supplyConsent: quote.hasDownloads && order.supplyConsent === true,
      // Where the buyer arrived from; a label for the seller's numbers only.
      channel: order.channel ?? "direct",
      cartId,
    },
    order.attemptId,
  );
  // "sold_out" here is the order writer's answer: the quote above saw stock,
  // and someone else took it before this order could. Nothing was charged.
  if (!placed.ok) return refuse(placed.reason, placed.reason === "failed" ? 502 : 409);

  // Still to be paid, on the provider's own page: that is where the browser
  // goes next, and the provider sends the buyer on to their order afterwards.
  if (placed.redirectUrl) return answer({ ok: true, orderUrl: placed.redirectUrl }, 201);

  // Null only when no order link can be issued at all, and checkoutProviderFor
  // above offers no provider in that case (lib/checkout/availability.ts), so
  // an order is never recorded and then answered as "nothing was charged".
  const path = await orderLinkPath(input.storefrontId, placed.orderId);
  if (!path) return refuse("failed", 500);
  return answer({ ok: true, orderUrl: `${path}?${PLACED_QUERY_PARAM}=1` }, 201);
}
