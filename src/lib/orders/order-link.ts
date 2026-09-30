// SERVER ONLY. THE ORDER LINK: how a buyer, who has no account, gets back to
// their own order.
//
// An order page (/s/<store>/order/<ref>) shows what was bought, where it is
// going, a download for a digital purchase, and the button that withdraws from
// the contract. Whoever holds the link can do all of that, so the link is a
// CREDENTIAL and is built like one:
//
//   ref = <order id> "." <HMAC-SHA256(secret, "order-link|" + order id)>
//
// - Never the payment provider's id. A Stripe checkout session id is known to
//   the seller's Stripe account, appears in their dashboard and in return
//   URLs; a credential should belong to the buyer and to us, nobody else.
// - Stateless: nothing is stored, so the confirmation email, the redirect after
//   paying and the test provider all build the SAME link from the order id,
//   and a redelivered payment that finds its order already written can still
//   send the buyer to it.
// - Checked in constant time, after a shape check and after the caller has
//   spent a rate-limit token, so a scan pays per guess and learns nothing from
//   timing.
//
// The key is ORDER_LINK_SECRET (wrangler secret put ORDER_LINK_SECRET).
// IN PRODUCTION THERE IS NO FALLBACK: with the secret unset no link can be
// issued and none can be accepted. The service-role key is deliberately not
// pressed into service there, because the two have opposite lifecycles: the
// service-role key is rotated as a breach response, and if it also keyed the
// order links that rotation would silently break every link already emailed
// to a buyer (their receipt, their download, their right to withdraw). Outside
// production (local dev, the e2e stack) it falls back to the service-role key
// so nothing has to be configured to run the flow. Rotating the secret retires
// every order link issued under it, so rotate deliberately.

import { orderPagePath, orderPageUrl } from "@/lib/storefront/product-page-url";

const PREFIX = "order-link|";
/** A uuid, a dot, then 43 base64url characters (a SHA-256 digest, unpadded). */
const REF_SHAPE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

function secret(): string {
  const dedicated = process.env.ORDER_LINK_SECRET;
  if (dedicated) return dedicated;
  if (process.env.NODE_ENV === "production") return "";
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
}

async function mac(orderId: string): Promise<Uint8Array | null> {
  const keyMaterial = secret();
  if (!keyMaterial) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(keyMaterial),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${PREFIX}${orderId}`));
  return new Uint8Array(signature);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The credential for one order, or null when no key is configured (which
 *  fails closed: no link can be issued, and none can be accepted). */
export async function orderRef(orderId: string): Promise<string | null> {
  const digest = await mac(orderId.toLowerCase());
  return digest ? `${orderId.toLowerCase()}.${base64Url(digest)}` : null;
}

/** The order id a ref proves, or null for anything else. */
export async function verifyOrderRef(ref: string): Promise<string | null> {
  const match = REF_SHAPE.exec(ref);
  if (!match) return null;
  const [, orderId, given] = match;
  const digest = await mac(orderId);
  if (!digest) return null;
  const expected = base64Url(digest);
  // Constant time over equal-length strings (the shape check fixed the length).
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ given.charCodeAt(index);
  }
  return difference === 0 ? orderId : null;
}

/** The order page's path, for a same-origin redirect. */
export async function orderLinkPath(storefrontId: string, orderId: string): Promise<string | null> {
  const ref = await orderRef(orderId);
  return ref ? orderPagePath(storefrontId, ref) : null;
}

/** The order page's absolute URL, for mail. */
export async function orderLinkUrl(storefrontId: string, orderId: string): Promise<string | null> {
  const ref = await orderRef(orderId);
  return ref ? orderPageUrl(storefrontId, ref) : null;
}

/**
 * The short number a buyer can read out or type: the first eight characters of
 * the order id, upper-cased. For recognising an order, never for opening one:
 * the lookup form that takes it also takes the buyer's email, and answers by
 * email, never on the page.
 */
export function orderNumber(orderId: string): string {
  return orderId.replace(/-/g, "").slice(0, 8).toUpperCase();
}
