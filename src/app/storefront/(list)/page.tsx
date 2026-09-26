import { getTranslations } from "next-intl/server";
import { pageShellClass } from "@/components/ui/surface-styles";
import { PageHeader } from "@/components/layout/PageHeader";
import { listAllProducts } from "@/lib/products/queries";
import { listStorefronts } from "@/lib/storefront/queries";
import { getSampleStorefrontFlags } from "@/lib/onboarding/queries";
import { StorefrontsList } from "@/components/storefront/StorefrontsList";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";

export async function generateMetadata() {
  const t = await getTranslations("Storefront.metadata");
  return { title: t("storefronts.title") };
}

// Auth is enforced by storefront/layout.tsx. The dashboard shell (sidebar) is
// supplied by (list)/layout.tsx rather than here, so that loading.tsx renders
// inside the same chrome instead of replacing it. The editor route sits outside
// this group and stays full-screen.
export default async function StorefrontsPage() {
  const t = await getTranslations("Storefront.metadata");
  // Products feed the cards' live grid previews (image tiles).
  const [storefronts, products, account, sampleFlags] = await Promise.all([
    listStorefronts(),
    listAllProducts(),
    getActiveAccount(),
    // The person's own flag, not the store's: see getSampleStorefrontFlags.
    getSampleStorefrontFlags(),
  ]);
  const canWrite = can(account?.role, "storefront.write");
  const { rows: storefrontRows, total: storefrontTotal } = storefronts;

  return (
    <main className={pageShellClass}>
      <PageHeader
        className="mb-6"
        title={t("storefronts.title")}
        subtitle={t("storefronts.subtitle")}
      />

      <StorefrontsList
        storefronts={storefrontRows}
        total={storefrontTotal}
        products={products}
        canWrite={canWrite}
        // Offered to anyone who can build a storefront, and only on a flag we
        // could actually read: no answer means no sample, not a sample that
        // cannot be hidden.
        sample={!canWrite || !sampleFlags ? null : sampleFlags.hidden ? "hidden" : "shown"}
      />
    </main>
  );
}
