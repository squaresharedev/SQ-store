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

  // The overview's storefront row summarizes across the seller's storefronts:
  // "saved" once any exist (the exact `total` says that), block counts over the
  // loaded page decide whether the grids are empty and which one to open.
  return (
    <main>
      <DashboardHome
        orders={orders}
        products={products}
        storefronts={{
          total: storefronts.total,
          rows: storefronts.rows.map(({ id, blockCount }) => ({ id, blockCount })),
        }}
      />
    </main>
  );
}
