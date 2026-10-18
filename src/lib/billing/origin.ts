// WHERE A SALE CAME FROM, in the pricing contract's words.
//
// An order's origin is stored as orders.channel (types/order-view.ts): there
// is one column for it, not two. This is the one place a channel becomes the
// origin the fee is worked out from.
//
// THE ORIGIN IS NEVER A BUYER'S TO CHOOSE WHERE IT MATTERS. The three direct
// origins pay the same fee, so which of them a link claims (`?via=button`) is
// attribution and nothing more. `marketplace` pays a different fee, and no
// request can claim it: the checkout body only accepts LINK_CHANNELS
// (lib/storefront/product-page-url.ts), which does not contain it. It will
// arrive with the marketplace, from a token the server signed.

import type { SaleOrigin } from "@/lib/pricing";
import type { OrderChannel } from "@/types/order-view";

/** Each channel's origin. Exhaustive: a new channel does not compile until it
 *  says which fee it pays. */
export const CHANNEL_ORIGIN: Record<OrderChannel, SaleOrigin> = {
  embed: "embed",
  button: "purchase_button",
  direct: "hosted_storefront",
  marketplace: "marketplace",
};

export function originForChannel(channel: OrderChannel): SaleOrigin {
  return CHANNEL_ORIGIN[channel];
}
