import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { EmbedFrameView } from "@/components/storefront-page/EmbedFrameView";
import { StorefrontPageView } from "@/components/storefront-page/StorefrontPageView";
import { buildSampleStorefront } from "@/lib/storefront/sample";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import {
  DEFAULT_PRODUCT_PAGE_CONFIG,
  MOTION_PRESETS,
  buyerVisibleBlocks,
  type ShapeBlock,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import type { StorefrontPageData } from "@/types/storefront-page";
import { FinishGallery } from "./FinishGallery";

// Living reference for the editor upgrade's MOTION AND FINISH workstream: the
// board's arrival, palette gradients, paper texture and the scrolling strip,
// on the sample storefront. No sign-in and no database. Dev-only: the route
// 404s in production builds.
//
//   ?view=board (default)   the hosted page, as a buyer meets it
//     &motion=subtle|lively   theme.motion
//     &embed=1                the embed frame instead of the hosted page
//   ?view=legacy            the sample with NONE of this workstream's fields,
//                           for the before/after comparison
//   ?view=panel             the editor controls, at the panel's real width

export const metadata = { title: "Motion and finish: dev gallery" };

type Query = {
  view?: string;
  motion?: string;
  embed?: string;
};

/** Fixed ids for the showcase rows, so a reload draws the same board. */
const SHOWCASE_ID = (n: number) => `0f1e2d3c-4b5a-4968-8776-${String(n).padStart(12, "0")}`;

/**
 * Rows added under the sample's own eight, so the board is taller than a
 * screen and the scroll reveal has somewhere to happen: a heading, three
 * shapes, a line of words, three more shapes. Shapes and words only, since
 * the sample has five products and a product appears once per board.
 */
function showcaseRows(): StorefrontBlock[] {
  const shape = (n: number, kind: ShapeBlock["kind"], color: string, x: number, y: number, w: number, h: number): ShapeBlock => ({
    type: "shape",
    id: SHOWCASE_ID(n),
    kind,
    color,
    x,
    y,
    w,
    h,
  });
  return [
    { type: "text", id: SHOWCASE_ID(1), text: "New this week", variant: "subheading", align: "left", x: 0, y: 8, w: 6, h: 1 },
    shape(2, "circle", "#0a0a0a", 0, 9, 2, 2),
    shape(3, "star", "#0a0a0a", 2, 9, 2, 2),
    shape(4, "rounded", "#0a0a0a", 4, 9, 2, 2),
    { type: "text", id: SHOWCASE_ID(5), text: "Made to be used every day.", variant: "body", align: "left", x: 0, y: 11, w: 6, h: 1 },
    shape(6, "hexagon", "#0a0a0a", 0, 12, 2, 2),
    shape(7, "ring", "#0a0a0a", 2, 12, 2, 2),
    shape(8, "pill", "#0a0a0a", 4, 12, 2, 1),
    shape(9, "sparkle", "#0a0a0a", 4, 13, 2, 1),
    { type: "text", id: SHOWCASE_ID(10), text: "Every piece is checked by hand before it ships, and wrapped in paper, never plastic.", variant: "body", align: "left", x: 0, y: 14, w: 6, h: 2 },
    shape(11, "burst", "#0a0a0a", 0, 16, 3, 2),
    shape(12, "diamond", "#0a0a0a", 3, 16, 3, 2),
  ];
}

/** A buyer's page, built the way the embed-frame gallery builds it. */
function pageFor(
  config: StorefrontConfig,
  sample: ReturnType<typeof buildSampleStorefront>,
  theme: StorefrontTheme,
  blocks: StorefrontBlock[],
): StorefrontPageData {
  return {
    id: "sample",
    name: sample.name,
    theme,
    ...(config.header ? { header: config.header } : {}),
    blocks,
    products: sample.products.map((product) => ({
      id: product.id,
      title: product.title,
      price: product.price,
      currency: product.currency,
      imageUrl: product.imageUrl,
      href: "#",
    })),
    tileLook: resolveTileLook({
      theme,
      productPage: DEFAULT_PRODUCT_PAGE_CONFIG,
      cartPage: { enabled: false },
    }),
    imageUrls: {},
    backgroundImageUrl: null,
    customFontUrl: null,
    seller: sample.seller,
    allowIndexing: false,
    url: "#",
  };
}

export default async function EditorFinishDevPage({
  searchParams,
}: {
  searchParams: Promise<Query>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const query = await searchParams;
  const sample = buildSampleStorefront(await getTranslations());
  const config = sample.config;

  if (query.view === "panel") return <FinishGallery theme={config.theme} />;

  const legacy = query.view === "legacy";
  const motion = MOTION_PRESETS.find((preset) => preset === query.motion);
  const theme: StorefrontTheme = legacy
    ? config.theme
    : {
        ...config.theme,
        rows: config.theme.rows + 10,
        ...(motion ? { motion } : {}),
      };
  const blocks = legacy ? buyerVisibleBlocks(config) : [...buyerVisibleBlocks(config), ...showcaseRows()];
  const page = pageFor(config, sample, theme, blocks);

  if (query.embed === "1") {
    // A real frame is exactly as tall as its content; shown as a page of its
    // own it scrolls inside a box, like the embed-frame gallery's.
    return (
      <div className="h-screen overflow-y-auto">
        <EmbedFrameView page={page} />
      </div>
    );
  }
  return <StorefrontPageView page={page} />;
}
