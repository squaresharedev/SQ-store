import { resolveTileLook } from "@/lib/storefront/tile-look";
import { bandFragment } from "@/lib/storefront/bands";
import { buttonLinkKey, headerLinkKey } from "@/lib/storefront/links";
import { productPagePath } from "@/lib/storefront/product-page-url";
import type { SampleStorefront } from "@/lib/storefront/sample";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  buyerVisibleBlocks,
  type StorefrontBand,
  type StorefrontBlock,
  type StorefrontConfig,
} from "@/types/storefront";
import type { StorefrontPageData, StorefrontTileProduct } from "@/types/storefront-page";

// THE LAYOUT GALLERY'S BOARDS (/dev/editor-layout): a storefront with three
// full-width bands (a colour, a gradient, a photo), words and buttons on them,
// small half-cell pieces, and the sample's own products; and the sample board
// untouched, as the legacy board the before/after render compares. Raw hex is
// allowed here: these are a gallery's fixtures.

/** Fixed ids, so pictures are stable between runs. */
const ID = {
  hero: "0b1e7a10-0000-4000-8000-000000000001",
  strip: "0b1e7a10-0000-4000-8000-000000000002",
  photo: "0b1e7a10-0000-4000-8000-000000000003",
  heading: "0b1e7a10-0000-4000-8000-000000000011",
  lede: "0b1e7a10-0000-4000-8000-000000000012",
  cta: "0b1e7a10-0000-4000-8000-000000000013",
  dot: "0b1e7a10-0000-4000-8000-000000000014",
  label: "0b1e7a10-0000-4000-8000-000000000015",
  quote: "0b1e7a10-0000-4000-8000-000000000016",
  more: "0b1e7a10-0000-4000-8000-000000000017",
  star: "0b1e7a10-0000-4000-8000-000000000018",
  outline: "0b1e7a10-0000-4000-8000-000000000019",
} as const;

/** The gallery's band photo: a picture the app already serves. */
export const GALLERY_BAND_PHOTO = "/sample-storefront/succulent.webp";

/** The gallery's header logo, likewise, and the key it stands in for. */
export const GALLERY_LOGO = "/img/logo.png";
const GALLERY_LOGO_KEY = "elements/gallery/logo.png";

export type LayoutBoardOptions = {
  /** Tilt one block, which makes the board freely arranged (no reflow). */
  free: boolean;
  /** Give the board a phone layout of its own (theme.mobileColumns). */
  ownPhone: boolean;
  /** The theme's corner radius. */
  radius: number;
};

/** The layout board, built from the sample's products and theme. */
export function layoutBoardConfig(sample: SampleStorefront, options: LayoutBoardOptions): StorefrontConfig {
  const [camera, headphones, watch, mouse, speaker] = sample.products.map((product) => product.id);
  const bands: StorefrontBand[] = [
    { id: ID.hero, y: 0, h: 2, background: { kind: "solid", color: "#1c1917" } },
    { id: ID.strip, y: 5, h: 1, background: { kind: "gradient", from: "#fef3c7", via: "#fde68a", to: "#fbcfe8", angle: 90 } },
    { id: ID.photo, y: 6, h: 3, background: { kind: "image", key: "images/gallery/succulent.webp", x: 50, y: 50, scale: 100, dim: "dark" } },
  ];
  const blocks: StorefrontBlock[] = [
    // On the dark band: words in a light ink picked for it, and a button.
    { type: "text", id: ID.heading, text: "New season, slower living", variant: "heading", align: "left", x: 0, y: 0, w: 4, h: 1, fine: { top: true } },
    { type: "text", id: ID.lede, text: "Small things, made to last.", variant: "body", align: "left", x: 0, y: 1, w: 3, h: 1, fine: { bottom: true } },
    { type: "button", id: ID.cta, label: "Shop the edit", link: { kind: "product", productId: camera }, x: 0, y: 1, w: 2, h: 1, fine: { top: true } },
    { type: "shape", id: ID.dot, kind: "circle", color: "#fbbf24", x: 5, y: 0, w: 1, h: 1, fine: { left: true, bottom: true } },
    { type: "shape", id: ID.star, kind: "star", color: "#f472b6", x: 4, y: 1, w: 1, h: 1, fine: { right: true, top: true } },
    // The products, on the plain board.
    { type: "product", productId: camera, x: 0, y: 2, w: 2, h: 3 },
    { type: "product", productId: headphones, x: 2, y: 2, w: 2, h: 3 },
    { type: "product", productId: watch, x: 4, y: 2, w: 2, h: 3 },
    // On the gradient strip: a half-cell tall label, centred between columns.
    { type: "text", id: ID.label, text: "Free returns within 14 days", variant: "subheading", align: "center", x: 1, y: 5, w: 4, h: 1, ...(options.free ? { rotation: 3 } : {}) },
    // On the photo band: words, and an outline button to the strip.
    { type: "text", id: ID.quote, text: "Picked by hand, packed with care.", variant: "heading", align: "center", x: 1, y: 6, w: 4, h: 2, fine: { left: true, right: true } },
    { type: "button", id: ID.outline, label: "Why we do it", link: { kind: "band", bandId: ID.strip }, look: "outline", x: 2, y: 8, w: 2, h: 1, fine: { bottom: true } },
    { type: "product", productId: mouse, x: 0, y: 9, w: 3, h: 2 },
    { type: "product", productId: speaker, x: 3, y: 9, w: 3, h: 2 },
    { type: "button", id: ID.more, label: "Read our story", link: { kind: "url", url: "https://example.com/story" }, look: "link", x: 2, y: 11, w: 2, h: 1, fine: { bottom: true } },
  ];
  return {
    ...sample.config,
    theme: {
      ...sample.config.theme,
      rows: 12,
      cornerRadius: options.radius,
      titleDisplay: "always",
      priceDisplay: "always",
      ...(options.ownPhone ? { mobileColumns: 4 } : {}),
    },
    header: {
      show: true,
      name: "Parallel Goods",
      bio: "Objects for slow mornings.",
      logo: { key: GALLERY_LOGO_KEY, size: "small" },
      links: [
        { label: "Shop", link: { kind: "product", productId: camera } },
        { label: "Returns", link: { kind: "band", bandId: ID.strip } },
        { label: "Journal", link: { kind: "url", url: "https://example.com/journal" } },
      ],
    },
    blocks,
    bands,
  };
}

/** A board's page payload, as the server builds it, from a config. */
export function galleryPage(
  sample: SampleStorefront,
  config: StorefrontConfig,
  { cart = false }: { cart?: boolean } = {},
): StorefrontPageData {
  const products: StorefrontTileProduct[] = sample.products.map((product) => ({
    id: product.id,
    title: product.title,
    price: product.price,
    currency: product.currency,
    imageUrl: product.imageUrl,
    href: "#",
  }));
  const links: NonNullable<StorefrontPageData["links"]> = {};
  for (const block of config.blocks) {
    if (block.type !== "button") continue;
    const link = block.link;
    links[buttonLinkKey(block)] =
      link.kind === "product"
        ? { kind: "product", href: productPagePath("sample", link.productId) }
        : link.kind === "band"
          ? { kind: "band", href: bandFragment(link.bandId) }
          : link.kind === "url"
            ? { kind: "url", href: link.url }
            : { kind: "storefront", href: "#" };
  }
  (config.header?.links ?? []).forEach((entry, index) => {
    links[headerLinkKey(index)] =
      entry.link.kind === "band"
        ? { kind: "band", href: bandFragment(entry.link.bandId) }
        : entry.link.kind === "url"
          ? { kind: "url", href: entry.link.url }
          : { kind: entry.link.kind, href: "#" };
  });
  const bands = config.bands;
  return {
    id: "sample",
    name: sample.name,
    theme: config.theme,
    ...(config.header ? { header: config.header } : {}),
    blocks: buyerVisibleBlocks(config),
    products,
    tileLook: resolveTileLook({ theme: config.theme, productPage: DEFAULT_PRODUCT_PAGE_CONFIG, cartPage: { enabled: false } }),
    imageUrls: {},
    backgroundImageUrl: null,
    customFontUrl: null,
    seller: sample.seller,
    allowIndexing: false,
    url: "#",
    ...(bands?.length ? { bands } : {}),
    ...(bands?.some((band) => band.background.kind === "image")
      ? { bandImageUrls: Object.fromEntries(bands.filter((band) => band.background.kind === "image").map((band) => [band.id, GALLERY_BAND_PHOTO])) }
      : {}),
    ...(Object.keys(links).length ? { links } : {}),
    ...(config.header?.logo ? { logoUrl: GALLERY_LOGO } : {}),
    // The sample is no real storefront: a cart here shows, and adds nothing.
    ...(cart ? { cart: {} } : {}),
  };
}
