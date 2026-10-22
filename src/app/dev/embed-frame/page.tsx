import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmbedFrameView } from "@/components/storefront-page/EmbedFrameView";
import { buildSampleStorefront } from "@/lib/storefront/sample";
import {
  PRICE_TAG_POSITIONS,
  SALE_BADGES,
  SALE_BADGE_LOOKS,
  CHIP_SCALES,
  TILE_SPOTS,
  TITLE_STYLES,
  buyerVisibleBlocks,
} from "@/types/storefront";
import type { StorefrontPageData, StorefrontTileProduct } from "@/types/storefront-page";

// Living reference for the storefront embed's frame: what a seller's board
// looks like inside their own website, drawn from the sample storefront. No
// sign-in and no database, so the look can be judged on a plain dev server at
// desktop and phone widths. The real thing, framed by a page on another
// origin, is /dev/embed-host. Dev-only: the route 404s in production builds.
//
// `?sale=1` puts the board on sale: every tile's regular price crossed out
// beside its sale price, and the sale chip, which says how much comes off. The
// sample reveals its labels on hover, so on sale they are shown always;
// `&tag=<price tag position>` and `&title=<title style>` move the price
// through every place a seller can put it, and `&chip=<what it shows>`,
// `&look=<sale chip look>`, `&chipAt=<spot>`, `&chipColor=<rrggbb>` and
// `&chipText=<rrggbb>` do the same for the chip. `&chips=cell` gives every
// tile the chips of one cell.

export const metadata = { title: "Embed frame: dev gallery" };

/** What the harness's sale takes off, in percent. */
const SALE_PERCENT = 20;

/** A colour from the query, given without its `#`: strict hex or nothing. */
function hexParam(value: string | undefined): string | undefined {
  return /^[0-9a-f]{6}$/.test(value ?? "") ? `#${value}` : undefined;
}

export default async function EmbedFrameDevPage({
  searchParams,
}: {
  searchParams: Promise<{
    sale?: string;
    tag?: string;
    title?: string;
    chip?: string;
    look?: string;
    chips?: string;
    chipAt?: string;
    chipColor?: string;
    chipText?: string;
  }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const onSale = query.sale === "1";
  const sample = buildSampleStorefront(await getTranslations());
  const tag = PRICE_TAG_POSITIONS.find((position) => position === query.tag);
  const title = TITLE_STYLES.find((style) => style === query.title);
  const chip = SALE_BADGES.find((badge) => badge === query.chip);
  const look = SALE_BADGE_LOOKS.find((candidate) => candidate === query.look);
  const chips = CHIP_SCALES.find((scale) => scale === query.chips);
  const chipAt = TILE_SPOTS.find((spot) => spot === query.chipAt);
  const chipColor = hexParam(query.chipColor);
  const chipText = hexParam(query.chipText);

  const page: StorefrontPageData = {
    id: "sample",
    name: sample.name,
    theme: onSale
      ? {
          ...sample.config.theme,
          titleDisplay: "always",
          priceDisplay: "always",
          ...(tag ? { priceTagPosition: tag } : {}),
          ...(title ? { titleStyle: title } : {}),
          ...(chip ? { saleBadge: chip } : {}),
          ...(look ? { saleBadgeLook: look } : {}),
          ...(chips ? { chipScale: chips } : {}),
          ...(chipAt ? { saleBadgePosition: chipAt } : {}),
          ...(chipColor ? { saleBadgeColor: chipColor } : {}),
          ...(chipText ? { saleBadgeTextColor: chipText } : {}),
        }
      : sample.config.theme,
    ...(sample.config.header ? { header: sample.config.header } : {}),
    blocks: buyerVisibleBlocks(sample.config),
    products: sample.products.map((product): StorefrontTileProduct => {
      const tile = {
        id: product.id,
        title: product.title,
        price: product.price,
        currency: product.currency,
        imageUrl: product.imageUrl,
        href: "#",
      };
      if (!onSale) return tile;
      const price = Math.round(product.price * (100 - SALE_PERCENT)) / 100;
      return { ...tile, price, regularPrice: product.price, offerPercent: SALE_PERCENT };
    }),
    imageUrls: {},
    backgroundImageUrl: null,
    customFontUrl: null,
    seller: sample.seller,
    allowIndexing: false,
    url: "#",
  };

  // A real frame is exactly as tall as its content, so its document never
  // scrolls (see globals.css). Shown as a page of its own it has to, hence the
  // scrolling box around it here.
  return (
    <div className="h-screen overflow-y-auto">
      <EmbedFrameView page={page} />
    </div>
  );
}
