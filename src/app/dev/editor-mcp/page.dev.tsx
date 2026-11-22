import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PreviewProbe } from "@/components/agent/PreviewProbe";
import { StorefrontPageView } from "@/components/storefront-page/StorefrontPageView";
import { PREVIEW_REGION_PARAM, parsePreviewRegion } from "@/lib/agent/preview/targets";
import { buildSampleStorefront } from "@/lib/storefront/sample";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import { buyerVisibleBlocks } from "@/types/storefront";
import type { StorefrontPageData } from "@/types/storefront-page";

// THE AGENT PREVIEW'S PAGE, without a database: the sample storefront drawn by
// the buyer's own StorefrontPageView, with the probe a real preview page
// carries (components/agent/PreviewProbe). It is how the probe's cell
// geometry is checked in a real browser: `?region=x,y,w,h` lays the invisible
// crop box over those cells exactly as /agent-preview does for
// preview_storefront, and each product tile links to `#<its id>` so its drawn
// box can be held against the box the cells were turned into. It is a legacy
// board: none of the editor upgrade's fields. Dev-only: 404s in production.

export const metadata = { title: "Agent preview: dev gallery" };

export default async function EditorMcpDevPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const region = parsePreviewRegion(query[PREVIEW_REGION_PARAM]);
  const sample = buildSampleStorefront(await getTranslations());
  const hrefOf = (id: string) => `#${id}`;

  const page: StorefrontPageData = {
    id: "sample",
    name: sample.name,
    theme: sample.config.theme,
    ...(sample.config.header ? { header: sample.config.header } : {}),
    blocks: buyerVisibleBlocks(sample.config),
    products: sample.products.map((product) => ({
      id: product.id,
      title: product.title,
      price: product.price,
      currency: product.currency,
      imageUrl: product.imageUrl,
      href: hrefOf(product.id),
    })),
    tileLook: resolveTileLook({ theme: sample.config.theme, productPage: sample.config.productPage, cartPage: { enabled: false } }),
    imageUrls: {},
    backgroundImageUrl: null,
    customFontUrl: null,
    seller: sample.seller,
    allowIndexing: false,
    url: "#",
  };

  return (
    <>
      <StorefrontPageView page={page} />
      <PreviewProbe
        targets={sample.products.map((product) => ({
          href: hrefOf(product.id),
          productId: product.id,
          title: product.title,
          status: "active",
        }))}
        region={region}
      />
    </>
  );
}
