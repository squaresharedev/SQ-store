import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmbedFrameView } from "@/components/storefront-page/EmbedFrameView";
import { buildSampleStorefront } from "@/lib/storefront/sample";
import { withSampleCardExtras } from "@/lib/storefront/sample-card-extras";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import { deriveTileStockState } from "@/lib/stock/badge";
import {
  BLUR_DIRECTIONS,
  BLUR_MAX,
  CARD_BUY_BUTTONS,
  CARD_HOVER_EFFECTS,
  DEFAULT_PRODUCT_PAGE_CONFIG,
  PRICE_TAG_POSITIONS,
  PRODUCT_PAGE_CTA_MAX,
  SALE_BADGES,
  SALE_BADGE_LOOKS,
  CHIP_SCALES,
  TILE_SPOTS,
  TITLE_STYLES,
  buyerVisibleBlocks,
  type StorefrontTheme,
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
//
// `?blur=<0..100>` frosts a shadow fade (shown always) and blurs every text
// block; `?photoBlur=<0..100>` blurs the product photos. `&blurFrom=<edge>`
// runs both from one edge (top, bottom, left, right) instead of all over.
//
// The card extras: `?hover=<lift|zoom|tilt>`, `&hoverPhoto=1` (the sample's
// products get a second photo, see withSampleCardExtras), `&buy=<solid|
// outline|link>` (with `&buyLabel=<words>`, `&buyColor=<hex>` and
// `&buyText=<hex>` for its own), `&rating=1` and `&lowStock=1`, the last two with the
// sample's dev-only ratings and stock. `&reviews=0` turns the product page's
// reviews off, which takes the stars away. `&shown=1` shows the title and
// price always (the sample reveals them on hover).

export const metadata = { title: "Embed frame: dev gallery" };

/** What the harness's sale takes off, in percent. */
const SALE_PERCENT = 20;

/** A blur amount from the query: a whole number in range, or nothing. */
function blurParam(value: string | undefined): number | undefined {
  const amount = Number(value);
  return value && Number.isInteger(amount) && amount >= 0 && amount <= BLUR_MAX ? amount : undefined;
}

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
    blur?: string;
    photoBlur?: string;
    blurFrom?: string;
    hover?: string;
    hoverPhoto?: string;
    buy?: string;
    buyLabel?: string;
    buyColor?: string;
    buyText?: string;
    rating?: string;
    lowStock?: string;
    reviews?: string;
    shown?: string;
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
  const blur = blurParam(query.blur);
  const photoBlur = blurParam(query.photoBlur);
  const blurFrom = BLUR_DIRECTIONS.find((direction) => direction === query.blurFrom);
  const hover = CARD_HOVER_EFFECTS.find((effect) => effect === query.hover);
  const buy = CARD_BUY_BUTTONS.find((button) => button === query.buy);
  const buyColor = hexParam(query.buyColor);
  const buyText = hexParam(query.buyText);
  const extras = {
    ...(hover ? { hoverEffect: hover } : {}),
    ...(query.hoverPhoto === "1" ? { hoverPhoto: true } : {}),
    ...(buy ? { buyButton: buy } : {}),
    ...(query.buyLabel ? { buyButtonLabel: query.buyLabel.slice(0, PRODUCT_PAGE_CTA_MAX) } : {}),
    ...(buyColor ? { buyButtonColor: buyColor } : {}),
    ...(buyText ? { buyButtonTextColor: buyText } : {}),
    ...(query.rating === "1" ? { showRating: true } : {}),
    ...(query.lowStock === "1" ? { showLowStock: true } : {}),
    ...(query.shown === "1" ? ({ titleDisplay: "always", priceDisplay: "always" } as const) : {}),
  };
  const products = withSampleCardExtras(sample.products);
  const productPage = {
    ...DEFAULT_PRODUCT_PAGE_CONFIG,
    ...(query.reviews === "0" ? { sections: [{ id: "reviews" as const, show: false }] } : {}),
  };
  const saleTheme: StorefrontTheme = onSale
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
    : sample.config.theme;

  const page: StorefrontPageData = {
    id: "sample",
    name: sample.name,
    theme: {
      ...saleTheme,
      ...(blur !== undefined
        ? ({ titleStyle: "shadow", titleDisplay: "always", titleShadowBlur: blur } as const)
        : {}),
      ...(photoBlur !== undefined ? { photoBlur } : {}),
      ...(blurFrom ? { photoBlurDirection: blurFrom } : {}),
      ...extras,
    },
    ...(sample.config.header ? { header: sample.config.header } : {}),
    blocks: buyerVisibleBlocks(sample.config).map((block) =>
      blur !== undefined && block.type === "text"
        ? { ...block, blur, ...(blurFrom ? { blurDirection: blurFrom } : {}) }
        : block,
    ),
    // As a buyer's board is handed them: the stock as a state, never a count.
    products: products.map((product): StorefrontTileProduct => {
      const stockState = deriveTileStockState(product);
      const tile = {
        id: product.id,
        title: product.title,
        price: product.price,
        currency: product.currency,
        imageUrl: product.imageUrl,
        ...(product.hoverImageUrl ? { hoverImageUrl: product.hoverImageUrl } : {}),
        ...(product.rating ? { rating: product.rating } : {}),
        ...(stockState ? { stockState } : {}),
        href: "#",
      };
      if (!onSale) return tile;
      const price = Math.round(product.price * (100 - SALE_PERCENT)) / 100;
      return { ...tile, price, regularPrice: product.price, offerPercent: SALE_PERCENT };
    }),
    tileLook: resolveTileLook({ theme: saleTheme, productPage }),
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
