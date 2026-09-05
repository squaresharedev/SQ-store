import type { Metadata } from "next";
import {
  getDashboardOrders,
  getProductsSummary,
  getProfileSummary,
  getExistingProductIds,
} from "@/lib/dashboard/queries";
import { listStorefronts } from "@/lib/storefront/queries";
import { getAccountStatus } from "@/lib/payments/mock";
import { DashboardHome } from "@/components/dashboard/DashboardHome";
import type { StorefrontAttentionInfo } from "@/lib/dashboard/attention";

export const metadata: Metadata = {
  title: "Overview",
};

// PROTECTED by (dashboard)/layout.tsx. All reads are owner-scoped (session +
// RLS) and strictly read-only against products / storefronts / orders.
export default async function DashboardOverviewPage() {
  const [orders, products, storefronts, profile, account] = await Promise.all([
    getDashboardOrders(),
    getProductsSummary(),
    listStorefronts(),
    getProfileSummary(),
    getAccountStatus(),
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

  return (
    <main>
      <DashboardHome
        orders={orders}
        products={products}
        storefronts={storefrontInfo}
        profile={profile}
        stripeConnected={account.connected}
      />
    </main>
  );
}
