import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import {
  parseStoredStorefrontConfig,
  storefrontIdSchema,
} from "@/lib/validation/storefront";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontConfig,
} from "@/types/storefront";

// Server Components / Route Handlers only (cookies() is Node-only — never
// middleware). RLS now permits reading any store you're a member of, so reads
// filter by the ACTIVE account id explicitly (your own store, or one you belong
// to). `getStorefront` still takes the row id because a store owns MANY
// storefronts and the URL selects which one — scoped to the active account.

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
  const account = await getActiveAccount();
  if (!account) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("storefronts")
    .select("id, name, config, updated_at")
    .eq("owner_id", account.accountId)
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
  const account = await getActiveAccount();
  if (!account) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("storefronts")
    .select("id, name, config")
    .eq("id", id)
    .eq("owner_id", account.accountId)
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
