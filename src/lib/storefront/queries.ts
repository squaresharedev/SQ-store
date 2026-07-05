import { createClient } from "@/lib/supabase/server";
import {
  parseStoredStorefrontConfig,
  storefrontIdSchema,
} from "@/lib/validation/storefront";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontConfig,
} from "@/types/storefront";

// Server Components / Route Handlers only (cookies() is Node-only — never
// middleware). RLS scopes every row to `owner_id = auth.uid()`, so a caller
// never supplies an owner id; `getStorefront` still takes the row id because a
// seller now owns MANY storefronts and the URL selects which one.

/** One storefront, fully loaded for the editor. */
export type StorefrontRecord = {
  /** Stable public id — the future embed / sales-attribution key. */
  id: string;
  name: string;
  config: StorefrontConfig;
};

/** A storefront as it appears in the list. */
export type StorefrontSummary = {
  id: string;
  name: string;
  /** Kept alongside config for the dashboard's cheap aggregate. */
  blockCount: number;
  /** ISO timestamp of the last save, for "updated X" + list ordering. */
  updatedAt: string;
  /** Full parsed config, so the card renders a faithful grid preview. */
  config: StorefrontConfig;
};

/**
 * The signed-in seller's storefronts, newest-edited first. A stored config that
 * fails the schema (stale shape, the initial '{}' default) falls back to the
 * default config rather than dropping the row from the list.
 */
export async function listStorefronts(): Promise<StorefrontSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("storefronts")
    .select("id, name, config, updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Failed to load storefronts: ${error.message}`);

  return data.map((row) => {
    const config =
      parseStoredStorefrontConfig(row.config) ?? DEFAULT_STOREFRONT_CONFIG;
    return {
      id: row.id,
      name: row.name,
      blockCount: config.blocks.length,
      updatedAt: row.updated_at,
      config,
    };
  });
}

/**
 * A single storefront by id, or null if it does not exist / isn't the caller's
 * (RLS scopes the read; a bad id shape short-circuits to a 404 upstream).
 */
export async function getStorefront(
  id: string,
): Promise<StorefrontRecord | null> {
  if (!storefrontIdSchema.safeParse(id).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("storefronts")
    .select("id, name, config")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load storefront: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    name: data.name,
    config:
      parseStoredStorefrontConfig(data.config) ?? DEFAULT_STOREFRONT_CONFIG,
  };
}
