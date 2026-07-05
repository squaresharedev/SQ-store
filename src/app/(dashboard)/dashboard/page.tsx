import type { Metadata } from "next";
import { getDashboardOrders, getProductsSummary } from "@/lib/dashboard/queries";
import { listStorefronts } from "@/lib/storefront/queries";
import { DashboardHome } from "@/components/dashboard/DashboardHome";

export const metadata: Metadata = {
  title: "Overview",
};

// PROTECTED by (dashboard)/layout.tsx. All reads are owner-scoped (session +
// RLS) and strictly read-only against products / storefronts / orders.
export default async function DashboardOverviewPage() {
  const [orders, products, storefronts] = await Promise.all([
    getDashboardOrders(),
    getProductsSummary(),
    listStorefronts(),
  ]);

  // The overview's storefront tile summarizes across all of the seller's
  // storefronts: "saved" once any exist, block count summed over them.
  const storefrontBlockCount = storefronts.reduce(
    (total, storefront) => total + storefront.blockCount,
    0,
  );

  return (
    <main>
      <DashboardHome
        orders={orders}
        products={products}
        storefrontSaved={storefronts.length > 0}
        storefrontBlockCount={storefrontBlockCount}
      />
    </main>
  );
}
