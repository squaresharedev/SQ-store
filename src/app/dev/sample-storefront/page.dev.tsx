import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StorefrontDesigner } from "@/components/storefront/StorefrontDesigner";
import { buildSampleStorefront } from "@/lib/storefront/sample";
import { withSampleCardExtras } from "@/lib/storefront/sample-card-extras";
import { withSampleSale } from "@/lib/storefront/sample-sale";

// Living reference for the sample storefront and its designer tour: the real
// designer in sample mode, exactly as /storefront/sample renders it, minus the
// account. No sign-in and no database, so the editor tour can be driven on a
// plain dev server at desktop and phone widths. `?tour=0` opens it without the
// tour starting by itself. `?extras=1` gives the sample's products a second
// photo, ratings and stock (withSampleCardExtras), so the card extras have
// something to draw; `?sale=1` puts every product on sale (withSampleSale), so
// the sale chip shows; `&setting=<id>` arrives on a setting, as a search
// result picked elsewhere does. Dev-only: the route 404s in production builds.

export const metadata = { title: "Sample storefront: dev harness" };

export default async function SampleStorefrontDevPage({
  searchParams,
}: {
  searchParams: Promise<{ tour?: string; extras?: string; sale?: string; setting?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const { tour, extras, sale, setting } = await searchParams;
  const sample = buildSampleStorefront(await getTranslations());
  const products = extras === "1" ? withSampleCardExtras(sample.products) : [...sample.products];
  return (
    <StorefrontDesigner
      sample={{ autoStartTour: tour !== "0" }}
      storefrontId="sample"
      initialName={sample.name}
      initialConfig={sample.config}
      products={sale === "1" ? withSampleSale(products) : products}
      sellerIdentity={sample.seller}
      shippingPolicy={sample.shippingPolicy}
      initialSetting={setting ?? null}
    />
  );
}
