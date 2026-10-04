import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getActiveAccount } from "@/lib/team/account-context";
import { toCurrency } from "@/lib/format/money";
import { DISCOUNT_COLUMNS, toDiscountView, type DiscountRow } from "@/lib/discounts/row";
import {
  DISCOUNT_PRODUCTS_MAX,
  LIVE_DISCOUNTS_MAX,
  type DiscountPerformance,
  type DiscountProductChoice,
  type DiscountView,
} from "@/types/discount";

// READ-ONLY discount reads for the dashboard. Server Components only. Every
// read names the ACTIVE store explicitly: RLS lets a team member read every
// store they belong to, and the page must show the one being worked on.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The store's discounts that are not deleted, newest first. */
export const listDiscounts = cache(async (): Promise<DiscountView[]> => {
  const account = await getActiveAccount();
  if (!account) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discounts")
    .select(DISCOUNT_COLUMNS)
    .eq("owner_id", account.accountId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(LIVE_DISCOUNTS_MAX);
  if (error) {
    console.error("[discounts] list failed", error.message);
    return [];
  }
  return ((data ?? []) as DiscountRow[]).flatMap((row) => toDiscountView(row) ?? []);
});

/** One discount of the active store, or null (malformed id, someone else's,
 *  or deleted: all "nothing to edit"). */
export async function getDiscount(id: string): Promise<DiscountView | null> {
  if (!UUID.test(id)) return null;
  const account = await getActiveAccount();
  if (!account) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discounts")
    .select(DISCOUNT_COLUMNS)
    .eq("owner_id", account.accountId)
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return toDiscountView(data as DiscountRow);
}

/**
 * What each discount sold (public.discount_performance), keyed by discount id.
 * Includes deleted discounts' orders, which the channel chart still counts.
 */
export const getDiscountPerformance = cache(async (): Promise<Map<string, DiscountPerformance>> => {
  const performance = new Map<string, DiscountPerformance>();
  const account = await getActiveAccount();
  if (!account) return performance;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("discount_performance", { p_seller_id: account.accountId });
  if (error) {
    console.error("[discounts] performance read failed", error.message);
    return performance;
  }
  // One row per discount AND currency: counts add up, money stays per currency.
  for (const row of data ?? []) {
    const entry = performance.get(row.discount_id) ?? {
      discountId: row.discount_id,
      uses: 0,
      orders: 0,
      revenue: [],
      given: [],
      lastOrderAt: null,
    };
    entry.uses += row.uses;
    entry.orders += row.orders;
    if (row.revenue_cents > 0) entry.revenue.push({ currency: row.currency, cents: row.revenue_cents });
    if (row.discount_cents > 0) entry.given.push({ currency: row.currency, cents: row.discount_cents });
    if (row.last_order_at && (!entry.lastOrderAt || row.last_order_at > entry.lastOrderAt)) {
      entry.lastOrderAt = row.last_order_at;
    }
    performance.set(row.discount_id, entry);
  }
  return performance;
});

/** The labels of the store's deleted discounts that still have orders, for
 *  the channel chart (a deleted code's sales still came from somewhere). */
export async function getArchivedDiscountLabels(
  ids: readonly string[],
): Promise<Map<string, Pick<DiscountView, "kind" | "code" | "shareChannel">>> {
  const labels = new Map<string, Pick<DiscountView, "kind" | "code" | "shareChannel">>();
  const account = await getActiveAccount();
  if (!account || ids.length === 0) return labels;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("discounts")
    .select("id, kind, code, share_channel")
    .eq("owner_id", account.accountId)
    .in("id", ids.slice(0, LIVE_DISCOUNTS_MAX * 2));
  if (error) return labels;
  for (const row of data ?? []) {
    labels.set(row.id, {
      kind: row.kind === "code" ? "code" : "automatic",
      code: row.code,
      shareChannel: row.share_channel,
    });
  }
  return labels;
}

/** The store's products, for the form's "choose products" list. */
export async function listProductChoices(): Promise<DiscountProductChoice[]> {
  const account = await getActiveAccount();
  if (!account) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("id, title, price_cents, currency")
    .eq("owner_id", account.accountId)
    .order("title", { ascending: true })
    .limit(DISCOUNT_PRODUCTS_MAX);
  if (error) {
    console.error("[discounts] product choices failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    priceCents: row.price_cents,
    currency: toCurrency(row.currency),
  }));
}
