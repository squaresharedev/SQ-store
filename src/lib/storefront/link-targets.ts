// SERVER ONLY. What the designer offers a button or a menu entry to lead to
// beyond the board itself: the active store's storefronts. RLS scopes the read
// to the account, like the storefront list; the save holds every storefront
// link to this store again (lib/storefront/layout-save.ts), so this list is a
// convenience, never the rule.

import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { bandPhotoKeys } from "@/lib/storefront/bands";
import type { StorefrontConfig } from "@/types/storefront";

/** How many storefronts the destination list offers. A store with more is
 *  rare, and an assistant can still name any of them. */
const LINKABLE_STOREFRONTS_MAX = 50;

/** The active store's storefronts, by name: id and name, nothing else. */
export async function listLinkableStorefronts(): Promise<{ id: string; name: string }[]> {
  const account = await getActiveAccount();
  if (!account) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("storefronts")
    .select("id, name")
    .eq("owner_id", account.accountId)
    .order("name", { ascending: true })
    .limit(LINKABLE_STOREFRONTS_MAX);
  if (error) {
    console.error("[storefront] linkable storefronts read failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({ id: row.id, name: row.name }));
}

/** Every object key the layout fields hold that the designer has to show
 *  (band photos, the header logo), for signing beside the page photos. */
export function layoutPhotoKeys(config: StorefrontConfig): string[] {
  return [...bandPhotoKeys(config.bands), ...(config.header?.logo ? [config.header.logo.key] : [])];
}
