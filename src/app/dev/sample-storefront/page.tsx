import { notFound } from "next/navigation";
import { StorefrontDesigner } from "@/components/storefront/StorefrontDesigner";
import {
  SAMPLE_PRODUCTS,
  SAMPLE_SELLER,
  SAMPLE_SHIPPING_POLICY,
  SAMPLE_STOREFRONT_CONFIG,
  SAMPLE_STOREFRONT_NAME,
} from "@/lib/storefront/sample";

// Living reference for the sample storefront and its designer tour: the real
// designer in sample mode, exactly as /storefront/sample renders it, minus the
// account. No sign-in and no database, so the editor tour can be driven on a
// plain dev server at desktop and phone widths. `?tour=0` opens it without the
// tour starting by itself. Dev-only: the route 404s in production builds.

export const metadata = { title: "Sample storefront: dev harness" };

export default async function SampleStorefrontDevPage({
  searchParams,
}: {
  searchParams: Promise<{ tour?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { tour } = await searchParams;
  return (
    <StorefrontDesigner
      sample={{ autoStartTour: tour !== "0", productCount: 0 }}
      storefrontId="sample"
      initialName={SAMPLE_STOREFRONT_NAME}
      initialConfig={SAMPLE_STOREFRONT_CONFIG}
      products={[...SAMPLE_PRODUCTS]}
      sellerIdentity={SAMPLE_SELLER}
      shippingPolicy={SAMPLE_SHIPPING_POLICY}
    />
  );
}
