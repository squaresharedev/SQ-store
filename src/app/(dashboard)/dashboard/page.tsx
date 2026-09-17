import type { Metadata } from "next";
import {
  getDashboardOrders,
  getProductsSummary,
  getProfileSummary,
  getExistingProductIds,
} from "@/lib/dashboard/queries";
import { listStorefronts } from "@/lib/storefront/queries";
import { getAccountStatus } from "@/lib/payments/mock";
import { getActiveAccount } from "@/lib/team/account-context";
import { getProfile } from "@/lib/auth/session";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";
import { sellerEmailVerificationRequired } from "@/lib/settings/seller-email-verification";
import { buildSetupSteps } from "@/lib/onboarding/steps";
import { productPageUrl } from "@/lib/storefront/product-page-url";
import { DashboardHome } from "@/components/dashboard/DashboardHome";
import type { OnboardingData } from "@/components/dashboard/OnboardingSlot";
import type { StorefrontAttentionInfo } from "@/lib/dashboard/attention";

export const metadata: Metadata = {
  title: "Overview",
};

// PROTECTED by (dashboard)/layout.tsx. All reads are owner-scoped (session +
// RLS) and strictly read-only against products / storefronts / orders.
export default async function DashboardOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tour?: string | string[] }>;
}) {
  const [orders, products, storefronts, profile, payments, account, ownProfile, params] =
    await Promise.all([
      getDashboardOrders(),
      getProductsSummary(),
      listStorefronts(),
      getProfileSummary(),
      getAccountStatus(),
      getActiveAccount(),
      // The SIGNED-IN person's row (select *): whether they have seen the
      // welcome flow is about them, not about the store they are viewing.
      getProfile(),
      searchParams,
    ]);

  // Collect all product IDs referenced by storefront blocks so we can detect
  // dead blocks (blocks whose product was deleted) in ONE query, not N per block.
  const referencedProductIds = Array.from(
    new Set(
      storefronts.rows.flatMap((sf) =>
        sf.config.blocks
          .filter((b): b is { type: "product"; productId: string } & typeof b =>
            b.type === "product" && "productId" in b,
          )
          .map((b) => b.productId),
      ),
    ),
  );

  // One extra query (not N+1): check which referenced product IDs still exist.
  const existingIds = await getExistingProductIds(referencedProductIds);
  const existingSet = new Set(existingIds);
  const deadBlockCount = referencedProductIds.filter(
    (id) => !existingSet.has(id),
  ).length;

  // Noindex check: storefronts with an explicitly stored productPage config
  // that has enabled=true and allowIndexing=false. Optional-chaining keeps this
  // from firing for storefronts that predate the product-page feature.
  const noindexStorefronts = storefronts.rows.filter(
    (sf) =>
      sf.config.productPage?.enabled === true &&
      sf.config.productPage?.allowIndexing === false,
  );
  const noindexProductPageCount = noindexStorefronts.length;
  const firstNoindexStorefrontId = noindexStorefronts[0]?.id ?? null;

  const storefrontInfo: StorefrontAttentionInfo = {
    total: storefronts.total,
    rows: storefronts.rows.map(({ id, blockCount }) => ({ id, blockCount })),
    noindexProductPageCount,
    deadBlockCount,
    firstNoindexStorefrontId,
  };

  // --- Setup: the checklist and the welcome flow ------------------------
  //
  // The gate's own answer for the ACTIVE account, deduped with the chrome's
  // banner, which asked the same question during this render. The checklist is
  // an OWNER's: a member on someone else's store cannot do that store's setup,
  // and a read failure shows no checklist rather than a wrong one.
  const identity = account ? await getTraderIdentityStatus(account.accountId) : null;
  const tour = Array.isArray(params.tour) ? params.tour[0] : params.tour;
  const tourRequested = tour === "1";

  let onboarding: OnboardingData | null = null;
  if (account?.isOwner) {
    const setup = identity?.ok
      ? buildSetupSteps({
          traderMissing: identity.missing,
          productCount: products.total,
          activeProductIds: products.activeProductIds,
          existingProductIds: existingIds,
          storefronts: storefronts.rows,
        })
      : null;
    onboarding = {
      setup,
      traderMissing: identity?.ok ? identity.missing : [],
      // STRICTLY null. A profile read that failed (no row) or a select that
      // does not carry the column (undefined) must never welcome an
      // established seller; only a recorded "not seen yet" does.
      welcomePending: ownProfile?.onboarding_completed_at === null,
      // Same strictness: only a recorded "not shown yet" shows the finished card.
      celebrationPending: ownProfile?.setup_celebrated_at === null,
      seller: ownProfile
        ? {
            businessName: ownProfile.tax_business_name ?? "",
            address: ownProfile.seller_address ?? "",
            email: ownProfile.seller_email ?? "",
          }
        : null,
      verificationOn: sellerEmailVerificationRequired(),
      livePageUrl: setup?.livePage
        ? productPageUrl(setup.livePage.storefrontId, setup.livePage.productId)
        : null,
      tourRequested,
    };
  } else if (account) {
    // The guided tour is useful to anyone; the setup is not theirs.
    onboarding = {
      setup: null,
      traderMissing: [],
      welcomePending: false,
      celebrationPending: false,
      seller: null,
      verificationOn: false,
      livePageUrl: null,
      tourRequested,
    };
  }

  return (
    <main>
      <DashboardHome
        orders={orders}
        products={products}
        storefronts={storefrontInfo}
        profile={profile}
        stripeConnected={payments.connected}
        onboarding={onboarding}
      />
    </main>
  );
}
