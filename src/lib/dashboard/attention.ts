import type { DashboardOrdersData, ProductsSummary } from "./queries";

/** One row of the overview's "Needs attention" module. */
export type AttentionItem = {
  key: string;
  label: string;
  description: string;
  /** In-app destination. Every href must resolve to a real route, and land on
   *  the surface that actually fixes the thing the row is complaining about. */
  href: string;
  actionLabel: string;
};

/** Only what the module needs from the storefront list: whether any exist and,
 *  if one is empty, which one to open in the designer. */
export type StorefrontAttentionInfo = {
  total: number;
  rows: { id: string; blockCount: number }[];
};

/**
 * Builds the action rows from real data. Pure and separate from the component
 * so the destinations can be asserted directly.
 *
 * Every row points at the surface that resolves it, as deep as the data allows:
 * a lone imageless product opens its own editor, a lone flagged order status
 * opens the orders list already filtered by it.
 */
export function buildAttentionItems({
  orders,
  products,
  storefronts,
}: {
  orders: DashboardOrdersData;
  products: ProductsSummary;
  storefronts: StorefrontAttentionInfo;
}): AttentionItem[] {
  const items: AttentionItem[] = [
    // Always present until Stripe Connect exists (payments stage). /payments is
    // where the connection lives; settings has nothing to say about payouts.
    {
      key: "stripe",
      label: "Connect Stripe to get paid",
      description: "Payouts stay blocked until your account is connected.",
      href: "/payments",
      actionLabel: "Open payments",
    },
  ];

  const saved = storefronts.total > 0;
  const blockCount = storefronts.rows.reduce(
    (total, storefront) => total + storefront.blockCount,
    0,
  );
  if (!saved || blockCount === 0) {
    // With one saved but empty, open THAT storefront's designer rather than the
    // list; with none, the list is where the create action lives.
    const empty =
      storefronts.rows.find((row) => row.blockCount === 0) ?? storefronts.rows[0];
    items.push({
      key: "storefront",
      label: saved ? "Your storefront is empty" : "Save your storefront",
      description: saved
        ? "Add products to your grid so buyers have something to see."
        : "Arrange your grid and save it to go live.",
      href: saved && empty ? `/storefront/${empty.id}` : "/storefront",
      actionLabel: saved && empty ? "Open designer" : "Create storefront",
    });
  }

  if (products.missingImage.length > 0) {
    const [first] = products.missingImage;
    const only = products.missingImage.length === 1;
    items.push({
      key: "images",
      label: `${products.missingImage.length} product${only ? "" : "s"} missing an image`,
      description: only
        ? `"${first.title}" has no display image yet.`
        : "Products without images look empty on your storefront.",
      href: only ? `/products/${first.id}/edit` : "/products",
      actionLabel: only ? "Add an image" : "Fix products",
    });
  }

  const flagged = orders.refundedCount + orders.disputedCount;
  if (flagged > 0) {
    const parts: string[] = [];
    if (orders.disputedCount > 0) parts.push(`${orders.disputedCount} disputed`);
    if (orders.refundedCount > 0) parts.push(`${orders.refundedCount} refunded`);
    // Filter the list only when a single status is involved; filtering on one
    // of two would hide orders the row just counted.
    const status =
      orders.disputedCount > 0 && orders.refundedCount > 0
        ? null
        : orders.disputedCount > 0
          ? "disputed"
          : "refunded";
    items.push({
      key: "flagged-orders",
      label: `${flagged} order${flagged === 1 ? "" : "s"} to review`,
      description: `${parts.join(", ")}.`,
      href: status ? `/orders?status=${status}` : "/orders",
      actionLabel: "Review orders",
    });
  }

  return items;
}
