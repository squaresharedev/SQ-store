import type { Metadata } from "next";
import { pageShellClass } from "@/components/ui/surface-styles";
import { PageHeader } from "@/components/layout/PageHeader";
import { listAllProducts } from "@/lib/products/queries";
import { listStorefronts } from "@/lib/storefront/queries";
import { StorefrontsList } from "@/components/storefront/StorefrontsList";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";
import { getTraderIdentityStatus } from "@/lib/settings/seller-identity";

export const metadata: Metadata = {
  title: "Storefronts",
};

// Auth is enforced by storefront/layout.tsx. The dashboard shell (sidebar) is
// supplied by (list)/layout.tsx rather than here, so that loading.tsx renders
// inside the same chrome instead of replacing it. The editor route sits outside
// this group and stays full-screen.
export default async function StorefrontsPage() {
  // Products feed the cards' live grid previews (image tiles).
  const [storefronts, products, account] = await Promise.all([
    listStorefronts(),
    listAllProducts(),
    getActiveAccount(),
  ]);
  const canWrite = can(account?.role, "storefront.write");
  const { rows: storefrontRows, total: storefrontTotal } = storefronts;

  // Read after the list rather than alongside it: the embed modal is the only
  // consumer, and it is behind a click.
  const identity = account
    ? await getTraderIdentityStatus(account.accountId)
    : { ok: true as const, missing: [] };

  return (
    <main className={pageShellClass}>
      <PageHeader
        className="mb-6"
        title="Storefronts"
        subtitle="Each storefront is its own grid and theme. Create as many as you need, then open one to edit it."
      />

      <StorefrontsList
        storefronts={storefrontRows}
        total={storefrontTotal}
        products={products}
        canWrite={canWrite}
        missingTraderDetails={identity.ok ? identity.missing : []}
      />
    </main>
  );
}
