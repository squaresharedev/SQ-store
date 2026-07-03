import { createClient } from "@/lib/supabase/server";
import { parseStoredStorefrontConfig } from "@/lib/validation/storefront";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontConfig,
} from "@/types/storefront";

// Server Components / Route Handlers only (cookies() is Node-only — never
// middleware). RLS scopes every row to `owner_id = auth.uid()`, so this read
// needs no caller-supplied id.

export type StorefrontRecord = {
  /** Stable public id — the future embed / sales-attribution key. */
  id: string;
  config: StorefrontConfig;
};

/**
 * The seller's storefront, or null if they have never saved one. A stored
 * config that fails the schema (stale shape, the initial '{}' default) falls
 * back to the default config rather than erroring.
 */
export async function getStorefront(): Promise<StorefrontRecord | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("storefronts")
    .select("id, config")
    .maybeSingle();
  if (error) throw new Error(`Failed to load storefront: ${error.message}`);
  if (!data) return null;

  // Upgrades older stored shapes in place; unrecognizable -> default.
  return {
    id: data.id,
    config:
      parseStoredStorefrontConfig(data.config) ?? DEFAULT_STOREFRONT_CONFIG,
  };
}
