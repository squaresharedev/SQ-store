import type { SupabaseClient } from "@supabase/supabase-js";
import { getUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";

/**
 * The signed-in person's two sample-storefront flags
 * (supabase/migrations/20260917_sample_storefront.sql).
 *
 * About the PERSON, not the active store: a team member hides the sample from
 * their own list and sees the designer tour once, whichever store they are
 * working in.
 *
 * Null when the read fails or does not carry the columns (a deployment ahead
 * of the migration). Callers treat null as "no sample, no tour", and only an
 * explicit null column as "not yet", the same strictness as the welcome flag.
 */
export async function getSampleStorefrontFlags(): Promise<{
  hidden: boolean;
  editorTourPending: boolean;
} | null> {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("sample_storefront_hidden_at, editor_tour_seen_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn("[onboarding] sample storefront flags read failed:", error.message);
    return null;
  }
  const hiddenAt: unknown = data.sample_storefront_hidden_at;
  const tourSeenAt: unknown = data.editor_tour_seen_at;
  // `undefined` means the row came back without the column: no answer.
  if (hiddenAt === undefined || tourSeenAt === undefined) return null;
  return { hidden: hiddenAt !== null, editorTourPending: tourSeenAt === null };
}

/**
 * How many products the active store has, for the storefront setup flow's
 * "no products yet" hint when it is opened from the sample storefront (which
 * otherwise reads nothing from the catalogue). A head count, no rows. Zero on a
 * failed read: the number only decides whether a hint shows.
 */
export async function countActiveAccountProducts(): Promise<number> {
  const account = await getActiveAccount();
  if (!account) return 0;
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", account.accountId);
  if (error) {
    console.warn("[onboarding] product count read failed:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Has this store EVER had an order, and does it have a storefront?
 *
 * Two existence checks, one row each at most, for pages that should look
 * different before a store has started at all: Analytics shows one "nothing to
 * measure yet" state instead of nine empty charts and a row of zeros.
 *
 * Scoped to the ACTIVE account like every other store read. Null on any read
 * failure, and a caller treats null as "render the normal page": that page is
 * always correct, only emptier.
 */
export async function getAccountActivity(): Promise<{
  hasOrders: boolean;
  hasStorefront: boolean;
} | null> {
  const account = await getActiveAccount();
  if (!account) return null;

  const supabase = await createClient();
  const [orders, storefronts] = await Promise.all([
    // The orders table is read through the untyped client, as in
    // lib/orders/queries.ts, so it is read the same way here.
    (supabase as SupabaseClient)
      .from("orders")
      .select("id")
      .eq("seller_id", account.accountId)
      .limit(1),
    supabase
      .from("storefronts")
      .select("id")
      .eq("owner_id", account.accountId)
      .limit(1),
  ]);
  if (orders.error || storefronts.error) {
    console.warn(
      "[onboarding] account activity read failed:",
      orders.error?.message ?? storefronts.error?.message,
    );
    return null;
  }
  return {
    hasOrders: (orders.data ?? []).length > 0,
    hasStorefront: (storefronts.data ?? []).length > 0,
  };
}
