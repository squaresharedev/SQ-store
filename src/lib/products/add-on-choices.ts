import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { loadProductSales, readStoreSales, salesCovering } from "@/lib/discounts/public";
import { toCurrency } from "@/lib/format/money";
import { isContentVisible, MODERATION_GATE_SELECT } from "@/lib/moderation/removal";
import { presignGetUrl } from "@/lib/r2";
import { PUBLIC_STOCK_SELECT, toPublicStockBadge } from "@/lib/stock/public";
import { chosenAddOns, hiddenAddOns, type AddOnHost } from "@/lib/products/add-on-visibility";
import { parseAddOnIds } from "@/lib/products/detail";
import { addOnHabits, NO_ADD_ON_HABITS, type AddOnHabits } from "@/lib/predictions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Currency, HiddenAddOn, ProductSale } from "@/types/product";

/** Safety bound for the picker, not pagination: one presign per row. */
const ADD_ON_CHOICES_MAX = 300;

/** How many of the newest paid orders the picker's suggestion learns from. */
const ADD_ON_HABIT_ORDERS = 1000;

/** One of the store's products, as the product form's "Add to order" picker
 *  lists it. Seller-side only (the dashboard), so status and kind ride along. */
export type AddOnChoice = {
  id: string;
  title: string;
  /** What a buyer pays right now: its running sale's price, when it has one. */
  priceCents: number;
  /** Its running sale as a buyer's page announces it, or null. */
  sale: ProductSale | null;
  currency: Currency;
  /** The cover photo, signed for the dashboard, or null without one. */
  imageUrl: string | null;
  /** Drafts can be chosen; buyers only see them once they are active. */
  status: "active" | "draft";
  /** Add-ons are offered only beside a product of the same kind. */
  isDigital: boolean;
  /** Can be chosen; buyers only see it once it is back in stock. */
  soldOut: boolean;
  /** Staff took it down; buyers cannot see it. */
  takenDown: boolean;
};

/**
 * The active store's products for the "Add to order" picker, newest first.
 * Every product is listed (the form leaves out the one being edited and the
 * other kind); scoped to the active account like every products read. `only`
 * narrows it to the products named (what one product has chosen), for a
 * preview that draws them.
 */
export async function listAddOnChoices(only?: readonly string[]): Promise<AddOnChoice[]> {
  const account = await getActiveAccount();
  if (!account) return [];
  if (only?.length === 0) return [];
  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select(
      `id, title, price_cents, currency, image_key, status, digital_file_key, created_at, ${MODERATION_GATE_SELECT}, ${PUBLIC_STOCK_SELECT}`,
    )
    .eq("owner_id", account.accountId);
  if (only) query = query.in("id", [...only]);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(ADD_ON_CHOICES_MAX);
  if (error) {
    console.error("[products] add-on choices failed", error.message);
    return [];
  }
  const rows = data ?? [];

  // Priced the way a buyer's page prices them. Sales that cannot be read show
  // the regular prices, like the designer's preview (preview-actions.ts).
  const admin = createAdminClient();
  const storeSales = await readStoreSales(admin, account.accountId, new Date());
  const pricing = await loadProductSales(admin, {
    ownerId: account.accountId,
    products: rows.map((row) => ({
      productId: row.id,
      regularPriceCents: row.price_cents,
      currency: toCurrency(row.currency),
      sales: storeSales ? salesCovering(storeSales, row.id) : [],
      listedAt: row.created_at ?? null,
    })),
  });

  return Promise.all(
    rows.map(async (row) => {
      const priced = pricing.get(row.id);
      return {
        id: row.id,
        title: row.title,
        priceCents: priced?.priceCents ?? row.price_cents,
        sale: priced?.sale ?? null,
        currency: toCurrency(row.currency),
        imageUrl: row.image_key ? await presignGetUrl(row.image_key) : null,
        status: row.status === "active" ? ("active" as const) : ("draft" as const),
        isDigital: row.digital_file_key !== null,
        soldOut: toPublicStockBadge(row)?.state === "sold_out",
        takenDown: !isContentVisible(row.moderation_status),
      };
    }),
  );
}

/**
 * What the active store's history says goes with one product (null: one not
 * saved yet), for the picker's one-tap suggestion (lib/predictions.ts
 * addOnHabits): its newest paid orders, main products and add-ons by buyer,
 * and what each of its products offers. Buyers' emails stay on the server;
 * only counts per product leave. Soft-fails to none, which offers nothing.
 */
export async function getAddOnHabits(productId: string | null): Promise<AddOnHabits> {
  const account = await getActiveAccount();
  if (!account) return NO_ADD_ON_HABITS;
  const supabase = await createClient();
  const [offers, orders] = await Promise.all([
    supabase.from("products").select("id, add_on_ids").eq("owner_id", account.accountId).limit(ADD_ON_CHOICES_MAX),
    // Nobody has bought a product that is not saved yet.
    productId
      ? (supabase as SupabaseClient)
          .from("orders")
          .select("buyer_email, product_id, add_ons:order_add_ons(product_id)")
          .eq("seller_id", account.accountId)
          .eq("status", "paid")
          .not("buyer_email", "is", null)
          .order("created_at", { ascending: false })
          .limit(ADD_ON_HABIT_ORDERS)
      : null,
  ]);
  if (offers.error || orders?.error) {
    console.error("[products] add-on habits failed", (offers.error ?? orders?.error)?.message);
    return NO_ADD_ON_HABITS;
  }
  type OrderRow = { buyer_email: string | null; product_id: string | null; add_ons: { product_id: string | null }[] | null };
  return addOnHabits(
    productId,
    ((orders?.data ?? []) as OrderRow[]).map((order) => ({
      buyer: order.buyer_email ?? "",
      productIds: [order.product_id, ...(order.add_ons ?? []).map((line) => line.product_id)].filter(
        (id): id is string => id !== null,
      ),
    })),
    (offers.data ?? []).map((row) => ({ id: row.id, addOnIds: parseAddOnIds(row.add_on_ids) })),
  );
}

/**
 * What one product chose that buyers are not offered right now (a draft, one
 * sold out...), for the seller's previews. `offered` are the ids the buyer's
 * page does offer (lib/products/add-ons.ts), so a product offering all it
 * chose costs no read.
 */
export async function listHiddenAddOns(
  ids: readonly string[],
  offered: readonly string[],
  host: AddOnHost,
): Promise<HiddenAddOn[]> {
  const rest = ids.filter((id) => !offered.includes(id));
  if (rest.length === 0) return [];
  return hiddenAddOns(chosenAddOns(await listAddOnChoices(rest), rest), host);
}
