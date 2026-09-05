import { LEGAL_VERSION } from "@/lib/settings/constants";
import type { DashboardOrdersData, ProductsSummary, ProfileSummary } from "./queries";

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

/**
 * The subset of profile data that drives the attention rows.
 * Mirrors ProfileSummary (from queries.ts) exactly; kept as a separate name so
 * this pure module does not depend on the async query surface directly.
 */
export type ProfileAttentionData = Pick<
  ProfileSummary,
  "taxBusinessName" | "sellerEmail" | "shippingPolicySet" | "legalAcceptedVersion"
>;

/** What the module needs from the storefront list. */
export type StorefrontAttentionInfo = {
  total: number;
  rows: { id: string; blockCount: number }[];
  /**
   * Count of storefronts with an explicitly stored `productPage` config that
   * has `enabled: true` and `allowIndexing: false`. Only counts storefronts
   * where the config is explicitly stored (not the fallback default), so
   * this row does not fire for every storefront that predates the feature.
   */
  noindexProductPageCount: number;
  /**
   * Count of storefront blocks that reference a product that no longer exists.
   * Computed by cross-referencing block productIds against the account's active
   * product IDs in one query (no N+1).
   */
  deadBlockCount: number;
  /**
   * The id of the first storefront whose product page has indexing off.
   * Null when noindexProductPageCount === 0. Used to link directly to the
   * offending designer rather than the storefront list.
   */
  firstNoindexStorefrontId: string | null;
};

/**
 * Builds the action rows from real data. Pure and separate from the component
 * so the destinations can be asserted directly.
 *
 * Every row points at the surface that resolves it, as deep as the data allows:
 * a lone imageless product opens its own editor, a lone flagged order status
 * opens the orders list already filtered by it.
 *
 * Profile-dependent rows are omitted when `profile` is null (the read failed
 * softly): a transient DB error should not show the seller a false alarm.
 */
export function buildAttentionItems({
  orders,
  products,
  storefronts,
  profile,
  stripeConnected,
}: {
  orders: DashboardOrdersData;
  products: ProductsSummary;
  storefronts: StorefrontAttentionInfo;
  /** Null when the profile read failed (soft fail); all profile rows are hidden. */
  profile: ProfileAttentionData | null;
  /**
   * Whether Stripe Connect is wired up. Comes from getAccountStatus() in
   * lib/payments/mock.ts so the overview and the payments page share one source
   * and can never disagree.
   */
  stripeConnected: boolean;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  // --- Payments -------------------------------------------------------

  // Stripe Connect row: present only until the account is connected.
  // /payments is where the connection lives; settings has nothing to say about
  // payouts.
  if (!stripeConnected) {
    items.push({
      key: "stripe",
      label: "Connect Stripe to get paid",
      description: "Payouts stay blocked until your account is connected.",
      href: "/payments",
      actionLabel: "Open payments",
    });
  }

  // --- Seller identity / legal ----------------------------------------

  // Business name: buyers see "Sold by Untitled storefront" until this is set.
  // Gated on profile being readable; a soft-fail read leaves this row hidden.
  if (profile && !profile.taxBusinessName) {
    items.push({
      key: "no-seller-identity",
      label: "Add your business name",
      description: 'Buyers see "Sold by Untitled storefront" until you set one.',
      href: "/settings/tax",
      actionLabel: "Add name",
    });
  }

  // Legal: seller must accept the current legal version before publishing.
  // Gated on profile being readable; also skipped when profile.legalAcceptedVersion
  // matches the current LEGAL_VERSION (no change needed).
  if (profile && profile.legalAcceptedVersion !== LEGAL_VERSION) {
    items.push({
      key: "no-legal",
      label: "Accept the updated legal terms",
      description: "Review and accept the latest terms to keep your account active.",
      href: "/settings/legal",
      actionLabel: "Review terms",
    });
  }

  // --- Product catalogue ----------------------------------------------

  // Buy path: active products with no purchase_url AND no seller contact email.
  // A seller_email gives every product page a "Contact seller" path; without
  // both, a buyer has no way to purchase or enquire.
  if (
    products.noBuyPathCount > 0 &&
    profile !== null &&
    !profile.sellerEmail
  ) {
    const count = products.noBuyPathCount;
    items.push({
      key: "no-buy-path",
      label: `${count} product${count === 1 ? "" : "s"} with no way to buy`,
      description:
        "Add a buy link, or set a contact email under Settings so buyers can reach you.",
      href: "/products",
      actionLabel: "Review products",
    });
  }

  // Shipping terms: the seller has physical products but has not written shipping
  // and returns terms yet. Buyers see a placeholder on physical product pages.
  if (products.hasPhysicalProducts && profile && !profile.shippingPolicySet) {
    items.push({
      key: "no-shipping",
      label: "Add your shipping terms",
      description:
        "Physical products need shipping and returns terms before buyers see full details.",
      href: "/settings/shipping",
      actionLabel: "Add terms",
    });
  }

  // --- Storefront -----------------------------------------------------

  // Empty or uncreated storefront.
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

  // --- Product appearance ---------------------------------------------

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

  // --- Orders ---------------------------------------------------------

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

  // --- Discoverability ------------------------------------------------

  // Noindex product pages: the product page is enabled but search-engine
  // indexing is off. Fires only for storefronts with an explicitly stored
  // productPage config (not the default), so older storefronts are not
  // needlessly flagged.
  if (storefronts.noindexProductPageCount > 0) {
    const count = storefronts.noindexProductPageCount;
    const href = storefronts.firstNoindexStorefrontId
      ? `/storefront/${storefronts.firstNoindexStorefrontId}`
      : "/storefront";
    items.push({
      key: "noindex-product-pages",
      label: "Product pages blocked from search",
      description:
        count === 1
          ? "One storefront has indexing turned off for its product pages."
          : `${count} storefronts have indexing turned off for their product pages.`,
      href,
      actionLabel: "Open designer",
    });
  }

  // Dead blocks: storefront blocks that reference a product that was deleted.
  // Buyers see an empty slot; the seller needs to remove or replace these.
  if (storefronts.deadBlockCount > 0) {
    const count = storefronts.deadBlockCount;
    items.push({
      key: "dead-blocks",
      label: `${count} storefront block${count === 1 ? "" : "s"} referencing deleted products`,
      description: "These blocks appear empty to visitors. Remove or replace them.",
      href: "/storefront",
      actionLabel: "Open storefront",
    });
  }

  return items;
}
