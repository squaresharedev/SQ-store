import { LEGAL_VERSION } from "@/lib/settings/constants";
import { STRIPE_CONNECT_AVAILABLE } from "@/lib/payments/availability";
import { msg, type MessageRef } from "@/i18n/types";
import type { DashboardOrdersData, ProductsSummary, ProfileSummary } from "./queries";

/**
 * One row of the overview's "Needs attention" module. The copy is MessageRefs,
 * resolved in the reader's language by the component that renders the row.
 */
export type AttentionItem = {
  key: string;
  label: MessageRef;
  description: MessageRef;
  /** In-app destination. Every href must resolve to a real route, and land on
   *  the surface that actually fixes the thing the row is complaining about. */
  href: string;
  actionLabel: MessageRef;
};

/**
 * The subset of profile data that drives the attention rows.
 * Mirrors ProfileSummary (from queries.ts) exactly; kept as a separate name so
 * this pure module does not depend on the async query surface directly.
 */
export type ProfileAttentionData = Pick<
  ProfileSummary,
  | "taxBusinessName"
  | "sellerEmail"
  | "sellerAddress"
  | "shippingPolicySet"
  | "legalAcceptedVersion"
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
  stripeConnectAvailable = STRIPE_CONNECT_AVAILABLE,
  setupVisible = false,
  twoFactorEnabled = true,
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
  /**
   * Whether a Stripe connection can actually be made yet. Defaults to the one
   * app-wide answer (lib/payments/availability.ts); a parameter so the row's
   * destination can still be asserted for the day it flips.
   */
  stripeConnectAvailable?: boolean;
  /**
   * The setup checklist is on screen above this module (lib/onboarding/
   * steps.ts). Rows it already states as steps stand down, so a new seller is
   * not told the same thing twice in two different voices.
   */
  setupVisible?: boolean;
  /**
   * Whether the SIGNED-IN person has two-factor authentication on. About the
   * person, not the store being viewed, so it applies to members too.
   * Defaults to true (no row) so a caller that cannot tell never nags.
   */
  twoFactorEnabled?: boolean;
}): AttentionItem[] {
  const items: AttentionItem[] = [];

  // --- Account security -----------------------------------------------

  // 2FA is optional, but this is where we push for it: first in the list,
  // and it stays until it's done. Not stood down by the setup checklist
  // either: a brand-new store is exactly when a password is the only lock.
  if (!twoFactorEnabled) {
    items.push({
      key: "two-factor",
      label: msg("Dashboard.attention.twoFactor.label"),
      description: msg("Dashboard.attention.twoFactor.description"),
      href: "/settings/security#two-factor",
      actionLabel: msg("Dashboard.attention.twoFactor.action"),
    });
  }

  // --- Payments -------------------------------------------------------

  // Stripe Connect row: present only while a connection can actually be made
  // and has not been. /payments is where the connection lives; settings has
  // nothing to say about payouts. Until Connect ships there is nothing there to
  // press, and a row whose one action lands on a disabled button is worse than
  // no row at all.
  if (stripeConnectAvailable && !stripeConnected) {
    items.push({
      key: "stripe",
      label: msg("Dashboard.attention.stripe.label"),
      description: msg("Dashboard.attention.stripe.description"),
      href: "/payments",
      actionLabel: msg("Dashboard.attention.stripe.action"),
    });
  }

  // --- Legal ----------------------------------------------------------

  // NO SELLER-IDENTITY ROW HERE. The publish gate is stated by the setup
  // checklist above this module (lib/onboarding/steps.ts), which is on screen
  // for an owner whenever this row would have fired, and by the chrome's banner
  // on every other page. A member viewing someone else's store never got it
  // either: getProfileSummary reads under own-row RLS and returns null for them.

  // Legal: a new seller agrees in the welcome flow (it cannot be left without
  // it). This row is for everyone that did not reach: accounts from before the
  // terms step, and anyone whose agreement predates the current Terms. It asks
  // rather than warns, and only says "updated" to someone who agreed to an
  // older version. Gated on profile being readable; skipped when the current
  // LEGAL_VERSION is already agreed to.
  if (profile && profile.legalAcceptedVersion !== LEGAL_VERSION) {
    const updated = profile.legalAcceptedVersion !== null;
    items.push({
      key: "no-legal",
      label: updated
        ? msg("Dashboard.attention.legal.labelUpdated")
        : msg("Dashboard.attention.legal.label"),
      description: updated
        ? msg("Dashboard.attention.legal.descriptionTermsUpdated")
        : msg("Dashboard.attention.legal.descriptionTerms"),
      href: "/settings/legal",
      actionLabel: msg("Dashboard.attention.legal.action"),
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
      label: msg("Dashboard.attention.noBuyPath.label", { count }),
      description: msg("Dashboard.attention.noBuyPath.description"),
      href: "/products",
      actionLabel: msg("Dashboard.attention.noBuyPath.action"),
    });
  }

  // Shipping terms: the seller has physical products but has not written shipping
  // and returns terms yet. Buyers see a placeholder on physical product pages.
  if (products.hasPhysicalProducts && profile && !profile.shippingPolicySet) {
    items.push({
      key: "no-shipping",
      label: msg("Dashboard.attention.noShipping.label"),
      description: msg("Dashboard.attention.noShipping.description"),
      href: "/settings/shipping",
      actionLabel: msg("Dashboard.attention.noShipping.action"),
    });
  }

  // --- Storefront -----------------------------------------------------

  // Empty or uncreated storefront. Stands down while the setup checklist is
  // showing: putting a product on a storefront is one of its steps, with the
  // same destination.
  const saved = storefronts.total > 0;
  const blockCount = storefronts.rows.reduce(
    (total, storefront) => total + storefront.blockCount,
    0,
  );
  if (!setupVisible && (!saved || blockCount === 0)) {
    // With one saved but empty, open THAT storefront's designer rather than the
    // list; with none, the list is where the create action lives.
    const empty =
      storefronts.rows.find((row) => row.blockCount === 0) ?? storefronts.rows[0];
    items.push({
      key: "storefront",
      label: saved
        ? msg("Dashboard.attention.storefront.labelEmpty")
        : msg("Dashboard.attention.storefront.labelNone"),
      description: saved
        ? msg("Dashboard.attention.storefront.descriptionEmpty")
        : msg("Dashboard.attention.storefront.descriptionNone"),
      href: saved && empty ? `/storefront/${empty.id}` : "/storefront",
      actionLabel:
        saved && empty
          ? msg("Dashboard.attention.storefront.actionOpen")
          : msg("Dashboard.attention.storefront.actionCreate"),
    });
  }

  // --- Product appearance ---------------------------------------------

  if (products.missingImage.length > 0) {
    const [first] = products.missingImage;
    const only = products.missingImage.length === 1;
    items.push({
      key: "images",
      label: msg("Dashboard.attention.images.label", {
        count: products.missingImage.length,
      }),
      description: only
        ? msg("Dashboard.attention.images.descriptionSingle", { title: first.title })
        : msg("Dashboard.attention.images.descriptionMultiple"),
      href: only ? `/products/${first.id}/edit` : "/products",
      actionLabel: only
        ? msg("Dashboard.attention.images.actionSingle")
        : msg("Dashboard.attention.images.actionMultiple"),
    });
  }

  // --- Orders ---------------------------------------------------------

  const flagged = orders.refundedCount + orders.disputedCount;
  if (flagged > 0) {
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
      label: msg("Dashboard.attention.flaggedOrders.label", { count: flagged }),
      // One sentence per combination rather than joined fragments, so a
      // language can order and inflect the two counts its own way.
      description:
        status === null
          ? msg("Dashboard.attention.flaggedOrders.descriptionBoth", {
              disputed: orders.disputedCount,
              refunded: orders.refundedCount,
            })
          : status === "disputed"
            ? msg("Dashboard.attention.flaggedOrders.descriptionDisputed", {
                count: orders.disputedCount,
              })
            : msg("Dashboard.attention.flaggedOrders.descriptionRefunded", {
                count: orders.refundedCount,
              }),
      href: status ? `/orders?status=${status}` : "/orders",
      actionLabel: msg("Dashboard.attention.flaggedOrders.action"),
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
      label: msg("Dashboard.attention.noindexPages.label"),
      description: msg("Dashboard.attention.noindexPages.description", { count }),
      href,
      actionLabel: msg("Dashboard.attention.noindexPages.action"),
    });
  }

  // Dead blocks: storefront blocks that reference a product that was deleted.
  // Buyers see an empty slot; the seller needs to remove or replace these.
  if (storefronts.deadBlockCount > 0) {
    const count = storefronts.deadBlockCount;
    items.push({
      key: "dead-blocks",
      label: msg("Dashboard.attention.deadBlocks.label", { count }),
      description: msg("Dashboard.attention.deadBlocks.description"),
      href: "/storefront",
      actionLabel: msg("Dashboard.attention.deadBlocks.action"),
    });
  }

  return items;
}
