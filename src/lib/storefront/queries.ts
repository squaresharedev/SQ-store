import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { getShippingPolicy } from "@/lib/settings/shipping-policy";
import { buildShippingProse } from "@/lib/shipping/policy-prose";
import { SHIPPING_SETTINGS_HREF } from "@/types/shipping-policy";
import {
  parseStoredStorefrontConfig,
  storefrontIdSchema,
} from "@/lib/validation/storefront";
import { parseStorefrontBrief } from "@/lib/validation/storefront-brief";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type StorefrontConfig,
} from "@/types/storefront";
import type { StorefrontBrief } from "@/types/storefront-brief";

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
  /** Public, rotatable identifier used by the embed snippet. */
  embedKey: string;
  /** Creation-flow answers. Empty when the flow was skipped or predates it.
   *  Carried so the NEXT storefront's flow can arrive pre-answered instead of
   *  asking the same seller the same questions again. */
  brief: StorefrontBrief;
};

/**
 * Safety bound, not pagination. Each row carries a full `config` JSONB that is
 * then Zod-parsed, so the per-row cost is real. Set far above any plausible
 * number of storefronts per seller.
 */
const STOREFRONT_LIST_LIMIT = 100;

/** The list page's read: one bounded page of summaries plus the EXACT total,
 *  so truncation is visible instead of silent. */
export type StorefrontsPage = {
  rows: StorefrontSummary[];
  /** Exact count of ALL the account's storefronts, not just the rows here. */
  total: number;
};

/**
 * The signed-in seller's storefronts, newest-edited first, with an exact
 * total. A stored config that fails the schema (stale shape, the initial '{}'
 * default) falls back to the default config rather than dropping the row from
 * the list.
 *
 * `offset` fetches further pages for the list's "Load more"; the bound stays
 * (each row carries a full Zod-parsed config JSONB, so per-row cost is real)
 * but past it the UI now shows "Showing X of N" + a way to get the rest,
 * instead of silently hiding the oldest storefronts.
 */
export async function listStorefronts(offset = 0): Promise<StorefrontsPage> {
  const account = await getActiveAccount();
  if (!account) return { rows: [], total: 0 };
  const supabase = await createClient();
  const from = Math.max(0, Math.trunc(offset));
  const { data, error, count } = await supabase
    .from("storefronts")
    .select("id, name, config, updated_at, embed_key, brief", {
      count: "exact",
    })
    .eq("owner_id", account.accountId)
    .order("updated_at", { ascending: false })
    // Stable tiebreak so paging can't skip or duplicate a row on ties.
    .order("id", { ascending: true })
    .range(from, from + STOREFRONT_LIST_LIMIT - 1);
  if (error) throw new Error(`Failed to load storefronts: ${error.message}`);

  const rows = (data ?? []).map((row) => {
    const config =
      parseStoredStorefrontConfig(row.config) ?? DEFAULT_STOREFRONT_CONFIG;
    return {
      id: row.id,
      name: row.name,
      blockCount: config.blocks.length,
      updatedAt: row.updated_at,
      config,
      embedKey: row.embed_key,
      brief: parseStorefrontBrief(row.brief),
    };
  });
  return { rows, total: count ?? rows.length };
}

/**
 * THE SHIPPING CHOICES A PRODUCT HAS, gathered for the product form.
 *
 * ONE ACCOUNT, ONE ANSWER — since 20260905_shipping_policy_on_profile. This
 * function used to page through every storefront the seller owned, collecting
 * a default and a profile list from each config, because that is where the
 * terms lived. It had to: a product can sit on several storefronts, so the
 * form offered every profile found anywhere and labelled each with the store
 * it came from, and the "default terms" the form previewed were really N
 * different defaults the seller had to pick between in their head.
 *
 * None of that was ever a real choice. Shipping terms belong to the business
 * doing the shipping, and now they are stored that way, so the answer is one
 * policy read from one row. The storefront query is gone entirely.
 *
 * Read for the ACTIVE ACCOUNT, not the signed-in user: a team member editing
 * the owner's catalogue must see the owner's terms. That read goes through the
 * service role (Settings is scoped to the signed-in user and `profiles` RLS
 * with it), gated by the active-account check above it — the same pattern the
 * trader identity uses.
 */
export type ShippingChoices = {
  /** The account's named exceptions, in the order the seller keeps them. */
  profiles: { id: string; name: string; dispatch: string; body: string }[];
  /** What "your usual terms" actually says, so the form can show the seller
   *  the words rather than the promise of them. Both parts may be "" for a
   *  seller who has written nothing yet. */
  fallback: { dispatch: string; body: string };
  /** Where to go to write any of it. Always the same page now, and never null:
   *  it exists whether or not the seller has a storefront yet. */
  editHref: string;
};

export async function getShippingChoices(): Promise<ShippingChoices> {
  const empty: ShippingChoices = {
    profiles: [],
    fallback: { dispatch: "", body: "" },
    editHref: SHIPPING_SETTINGS_HREF,
  };
  const account = await getActiveAccount();
  if (!account) return empty;

  const policy = await getShippingPolicy(account.accountId);
  return {
    profiles: (policy.profiles ?? []).map((profile) => ({
      id: profile.id,
      name: profile.name,
      dispatch: profile.dispatch ?? "",
      body: profile.body,
    })),
    // The same generator the product page runs, so the preview in the form is
    // the text a buyer gets and not a second rendering of the same answers.
    fallback: {
      dispatch: policy.dispatch ?? "",
      body: buildShippingProse(policy).shipping,
    },
    editHref: SHIPPING_SETTINGS_HREF,
  };
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
