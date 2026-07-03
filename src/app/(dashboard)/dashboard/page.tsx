import type { Metadata } from "next";
import { getDashboardOrders, getProductsSummary } from "@/lib/dashboard/queries";
import { getStorefront } from "@/lib/storefront/queries";
import { DashboardHome } from "@/components/dashboard/DashboardHome";

export const metadata: Metadata = {
  title: "Overview",
};

// PROTECTED by (dashboard)/layout.tsx. All reads are owner-scoped (session +
// RLS) and strictly read-only against products / storefronts / orders.
export default async function DashboardOverviewPage() {
  const [orders, products, storefront] = await Promise.all([
    getDashboardOrders(),
    getProductsSummary(),
    getStorefront(),
  ]);

  return (
    <main>
      <DashboardHome
        orders={orders}
        products={products}
        storefrontSaved={storefront !== null}
        storefrontBlockCount={storefront?.config.blocks.length ?? 0}
      />
    </main>
  );
}
