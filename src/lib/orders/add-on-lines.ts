// SERVER ONLY. An order's "Add to your order" lines (order_add_ons), as the
// mail and the bell name them: what else went in the box, in the seller's
// order, from the order's own snapshot.

import type { createAdminClient } from "@/lib/supabase/admin";
import { parseOrderSelection } from "@/lib/orders/selection";
import type { OrderSelection } from "@/types/order-view";

export type OrderGoodsLine = {
  productTitle: string;
  quantity: number;
  selection: OrderSelection[];
};

/** Best effort: a line that cannot be read is one the mail does not name,
 *  never a reason to hold the mail back. */
export async function orderAddOnGoods(
  admin: ReturnType<typeof createAdminClient>,
  orderId: string,
): Promise<OrderGoodsLine[]> {
  const { data, error } = await admin
    .from("order_add_ons")
    .select("product_title, quantity, selected_options, position")
    .eq("order_id", orderId)
    .order("position", { ascending: true });
  if (error) {
    console.error("[orders] add-on lines read failed:", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    productTitle: row.product_title,
    quantity: row.quantity,
    selection: parseOrderSelection(row.selected_options),
  }));
}
