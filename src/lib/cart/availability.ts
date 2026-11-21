// SERVER ONLY. THE CART'S LAUNCH SWITCH. The cart ships dark: built, tested
// and switched off in production until CART_ENABLED=1 is set there (the
// owner's call, after the migration is applied and the whole flow verified).
// Under `next dev` it is on unless CART_ENABLED=0, so it can be worked on and
// driven end to end locally.
//
// The seller's own switch (CartPageConfig.enabled, lib/storefront/cart-page.ts)
// and whether our checkout can sell the product at all decide the rest.

import { checkoutProviderFor } from "@/lib/checkout/availability";
import { cartSwitchedOn, resolveCartPage } from "@/lib/storefront/cart-page";
import type { CartPageConfig, StorefrontConfig } from "@/types/storefront";

export function cartLaunched(): boolean {
  const flag = process.env.CART_ENABLED;
  if (flag === "1") return true;
  if (flag === "0") return false;
  return process.env.NODE_ENV === "development";
}

/**
 * Whether the EMBED FRAME can write a cart. The frame runs on the embed's own
 * host (embed.squareshare.eu) and calls the cart routes on that same origin,
 * so they must be served there: one more Worker route for this Worker,
 * `embed.squareshare.eu/api/cart/*`, added in Cloudflare by hand like the
 * frame's own (see the STOREFRONT EMBED steps in wrangler.jsonc). Until
 * EMBED_CART_API=1 says it is, the frame's cards open the product's page as
 * before and the frame stores nothing. Under `next dev` the embed and the app
 * share one origin, so it is on unless EMBED_CART_API=0.
 */
export function embedCartWritable(): boolean {
  const flag = process.env.EMBED_CART_API;
  if (flag === "1") return true;
  if (flag === "0") return false;
  return process.env.NODE_ENV === "development";
}

/**
 * The storefront's cart as its pages draw it, or null where buyers have none
 * there: not launched, switched off by the seller, or no checkout that can
 * take this store's payment (lib/checkout/availability.ts). The ONE answer,
 * for every page that shows a cart button.
 */
export async function cartFor(store: {
  ownerId: string;
  config: Pick<StorefrontConfig, "cartPage">;
}): Promise<CartPageConfig | null> {
  if (!cartLaunched() || !cartSwitchedOn(store.config)) return null;
  return (await checkoutProviderFor(store.ownerId)) ? resolveCartPage(store.config) : null;
}
