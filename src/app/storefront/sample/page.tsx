import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StorefrontDesigner } from "@/components/storefront/StorefrontDesigner";
import { countActiveAccountProducts, getSampleStorefrontFlags } from "@/lib/onboarding/queries";
import {
  SAMPLE_PRODUCTS,
  SAMPLE_SELLER,
  SAMPLE_SHIPPING_POLICY,
  SAMPLE_STOREFRONT_CONFIG,
  SAMPLE_STOREFRONT_NAME,
} from "@/lib/storefront/sample";
import { getActiveAccount } from "@/lib/team/account-context";
import { can } from "@/lib/team/permissions";

export const metadata: Metadata = {
  title: "Sample storefront",
};

/**
 * The sample storefront in the designer (lib/storefront/sample.ts).
 *
 * A static segment beside `[id]`, so "sample" never reaches the storefront
 * lookup. Everything the designer is handed comes from code: no storefront row,
 * no catalogue rows, no signed URLs (the pictures are static files). The reads
 * are the person's own "has the designer tour started" flag and a head count of
 * the store's products, for the setup flow "Create your own" opens in place.
 *
 * Auth is the layout's (storefront/layout.tsx). Read-only members go back to the
 * list for the same reason as on a real storefront: this is an editing surface,
 * and a viewer has nothing to try in it.
 */
export default async function SampleStorefrontPage({
  searchParams,
}: {
  /** `?setting=<id>` from a search result picked outside the editor. */
  searchParams: Promise<{ setting?: string | string[] }>;
}) {
  const { setting } = await searchParams;
  const initialSetting = Array.isArray(setting) ? setting[0] : setting;

  const account = await getActiveAccount();
  if (!can(account?.role, "storefront.write")) redirect("/storefront");

  const [flags, productCount] = await Promise.all([
    getSampleStorefrontFlags(),
    countActiveAccountProducts(),
  ]);

  return (
    <StorefrontDesigner
      sample={{ autoStartTour: flags?.editorTourPending === true, productCount }}
      storefrontId="sample"
      initialName={SAMPLE_STOREFRONT_NAME}
      initialConfig={SAMPLE_STOREFRONT_CONFIG}
      products={[...SAMPLE_PRODUCTS]}
      initialSetting={initialSetting ?? null}
      sellerIdentity={SAMPLE_SELLER}
      shippingPolicy={SAMPLE_SHIPPING_POLICY}
      role={account?.role ?? null}
      accountId={account?.accountId ?? null}
    />
  );
}
