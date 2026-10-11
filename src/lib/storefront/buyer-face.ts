// SERVER ONLY. What of a storefront a buyer is shown on the pages that
// OUTLIVE its moderation state.
//
// A buyer's order page, and the "find your order" form that leads back to it,
// stay reachable when a shop is paused, removed or still waiting on the
// automatic check: they paid, and their way back to that outlives the shop.
// But those pages dress themselves in the storefront's own name, colours,
// header and photos, and that is seller content nobody has approved. So while
// the storefront is not live they wear the default design instead and name the
// seller by their trader name, which is checked before it is ever stored
// (lib/moderation/auto/seller-text.ts).

import { isContentVisible } from "@/lib/moderation/removal";
import { parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import { DEFAULT_STOREFRONT_CONFIG, type StorefrontConfig } from "@/types/storefront";

/**
 * The name and config a buyer-facing page may render for this storefront: its
 * own while it is live, the neutral defaults otherwise. Null only when a live
 * storefront's stored config cannot be read at all.
 */
export function buyerFacingStorefront(
  row: { name: string; config: unknown; moderation_status: string | null },
  traderName: string | undefined,
): { name: string; config: StorefrontConfig } | null {
  if (!isContentVisible(row.moderation_status)) {
    return { name: traderName ?? "", config: DEFAULT_STOREFRONT_CONFIG };
  }
  const config = parseStoredStorefrontConfig(row.config);
  return config ? { name: row.name, config } : null;
}
