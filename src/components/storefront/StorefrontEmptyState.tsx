"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { emptyShowcaseClass } from "@/components/ui/surface-styles";
import { AddShowcase } from "@/components/ui/AddShowcase";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  EMPTY_STOREFRONT_HEADER,
  type ShapeKind,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontFont,
} from "@/types/storefront";
import { StorefrontPreview } from "./StorefrontPreview";

/**
 * The two storefronts either side of the create card, as different from each
 * other as two shops can be, so the picture says "yours can look like
 * anything" as well as "yours goes here":
 *  - left, KOBALT: a white canvas, blue wordmark, blue shapes, and light
 *    studio shots of white gadgets on sharp tiles;
 *  - right, PINOUT: an electronics-parts shop on a circuit-board green canvas,
 *    gold type and gold rings for the board's pads, and parts all cut from one
 *    flat-lay photo (Unsplash zP7X_B86xOg), so they share one background.
 * Real photos (/public/empty-state), drawn by the real StorefrontPreview so
 * they can never drift from how a storefront renders.
 *
 * Square boards on a fine 4x4 grid: more, smaller cells in the same space, so
 * each board reads as a whole shop rather than three big pictures.
 *
 * Mirrored: each board's big tile is on its OUTER side, away from the card, so
 * the column tucked under the card is small tiles and shapes, never the hero.
 *
 * The products are display-only stand-ins: nothing reads them but the preview.
 */
const PHOTOS = [
  "camera",
  "headphones",
  "mouse",
  "watch-white",
  "uno",
  "servo",
  "joystick",
  "pot",
  "leds",
  "lcd",
  "battery",
] as const;
type Photo = (typeof PHOTOS)[number];

const PRODUCTS = new Map<Photo, Product>(
  PHOTOS.map((key, index) => [
    key,
    {
      id: `e5a3e1d2-0c4f-4b6e-9a61-${String(index + 1).padStart(12, "0")}`,
      title: key,
      description: "",
      price: 0,
      currency: "EUR",
      status: "active",
      imageUrl: `/empty-state/tile-${key}.webp`,
      digitalFileName: null,
      trackStock: false,
      stockQuantity: null,
      lowStockThreshold: 3,
      maxPerOrder: 10,
    },
  ]),
);
const PRODUCTS_BY_ID: ReadonlyMap<string, Product> = new Map(
  [...PRODUCTS.values()].map((product) => [product.id, product]),
);

/** Both boards' grid: square, and finer than a real storefront's default, so
 *  a thumbnail-sized board still holds a whole shop. */
const SHOWCASE_GRID = 4;
const SHOWCASE_GAP = 4;

/** The shops' names. Brand names, so the same in every locale. */
const KOBALT_NAME = "kobalt.";
const PINOUT_NAME = "PINOUT";

const KOBALT_WHITE = "#ffffff";
const KOBALT_BLUE = "#1d4ed8";
const PCB_GREEN = "#0b3b2c";
const PAD_GOLD = "#fbbf24";

type Cell = [x: number, y: number, w: number, h: number];

// Every block needs an id of its own; a counter per board keeps them stable
// and unique without hand-writing a uuid for each one.
function blockId(board: number, index: number) {
  return `d7c1e2a0-4b3f-4e6a-9c1d-${String(board * 100 + index).padStart(12, "0")}`;
}

function board(
  index: number,
  look: { canvas: string; accent: string },
  blocks: (id: (n: number) => string) => StorefrontBlock[],
): StorefrontConfig {
  return {
    ...DEFAULT_STOREFRONT_CONFIG,
    theme: {
      ...DEFAULT_STOREFRONT_CONFIG.theme,
      background: { kind: "solid", color: look.canvas },
      accent: look.accent,
      cornerRadius: 0,
      gridGap: SHOWCASE_GAP,
      columns: SHOWCASE_GRID,
      rows: SHOWCASE_GRID,
      // Pictures only on the tiles: a title or a price at this size is a
      // smudge. The shop's words are its own text blocks.
      showTitle: false,
      priceTagPosition: "hidden",
      soldOutBadge: false,
    },
    header: EMPTY_STOREFRONT_HEADER,
    blocks: blocks((n) => blockId(index, n)),
  };
}

const product = (key: Photo, [x, y, w, h]: Cell): StorefrontBlock => ({
  type: "product",
  productId: PRODUCTS.get(key)!.id,
  x,
  y,
  w,
  h,
});

const shape = (id: string, kind: ShapeKind, color: string, [x, y, w, h]: Cell): StorefrontBlock => ({
  type: "shape",
  id,
  kind,
  color,
  x,
  y,
  w,
  h,
});

const heading = (id: string, text: string, font: StorefrontFont, [x, y, w, h]: Cell): StorefrontBlock => ({
  type: "text",
  id,
  text,
  variant: "heading",
  align: "left",
  bold: true,
  font,
  x,
  y,
  w,
  h,
});

const KOBALT = board(1, { canvas: KOBALT_WHITE, accent: KOBALT_BLUE }, (id) => [
  heading(id(1), KOBALT_NAME, "sans", [0, 0, 3, 1]),
  shape(id(2), "sparkle", KOBALT_BLUE, [3, 0, 1, 1]),
  product("camera", [0, 1, 2, 2]),
  product("headphones", [2, 1, 1, 1]),
  shape(id(3), "circle", KOBALT_BLUE, [3, 1, 1, 1]),
  product("mouse", [2, 2, 1, 1]),
  shape(id(4), "quarter", KOBALT_BLUE, [3, 2, 1, 1]),
  shape(id(5), "ring", KOBALT_BLUE, [0, 3, 1, 1]),
  product("watch-white", [1, 3, 1, 1]),
  shape(id(6), "half", KOBALT_BLUE, [2, 3, 1, 1]),
  shape(id(7), "square", KOBALT_BLUE, [3, 3, 1, 1]),
]);

const PINOUT = board(2, { canvas: PCB_GREEN, accent: PAD_GOLD }, (id) => [
  shape(id(1), "ring", PAD_GOLD, [0, 0, 1, 1]),
  heading(id(2), PINOUT_NAME, "mono", [1, 0, 3, 1]),
  product("leds", [0, 1, 1, 1]),
  product("servo", [1, 1, 1, 1]),
  product("uno", [2, 1, 2, 2]),
  shape(id(3), "circle", PAD_GOLD, [0, 2, 1, 1]),
  product("joystick", [1, 2, 1, 1]),
  product("pot", [0, 3, 1, 1]),
  product("battery", [1, 3, 1, 1]),
  product("lcd", [2, 3, 2, 1]),
]);

function Board({ config, className }: { config: StorefrontConfig; className?: string }) {
  return (
    // The frame and the clip live here, not on the showcase's side slot.
    // Square, like every tile on both boards.
    <div className={cn("size-full overflow-hidden shadow-lg", className)}>
      <StorefrontPreview config={config} productsById={PRODUCTS_BY_ID} />
    </div>
  );
}

// A white board on a white page needs an edge of its own; the green one has
// its canvas.
const KOBALT_BOARD = <Board config={KOBALT} className="ring-1 ring-border" />;
const PINOUT_BOARD = <Board config={PINOUT} />;

/**
 * The storefront list with nothing in it. The create card is the call to
 * action. `data-tour` goes on that card: it is one of the list's two create
 * buttons.
 */
export function StorefrontEmptyState({
  canWrite,
  onCreate,
  creating = false,
  "data-tour": dataTour,
}: {
  canWrite: boolean;
  onCreate: () => void;
  /** The setup flow has handed back an id and the route change is under way. */
  creating?: boolean;
  "data-tour"?: string;
}) {
  const t = useTranslations("Storefront.list");
  return (
    <div className={emptyShowcaseClass}>
      <div className="flex flex-col items-center">
        <AddShowcase
          card={
            canWrite
              ? {
                  onClick: onCreate,
                  disabled: creating,
                  label: creating ? t("creating") : t("create"),
                  className: "h-32 w-28 rounded-md sm:h-40 sm:w-44",
                  "data-tour": dataTour,
                }
              : undefined
          }
          className="[--showcase-tuck:1.25rem] sm:[--showcase-tuck:2rem]"
          exampleClassName="mt-10 aspect-square w-28 sm:w-52"
          left={KOBALT_BOARD}
          right={PINOUT_BOARD}
        />
        <h2 className="mt-10 text-lg font-semibold text-foreground">
          {t("emptyHeading")}
        </h2>
        <p className="mt-1 max-w-sm font-inter text-sm text-muted-foreground">
          {canWrite ? t("emptyHintOwner") : t("emptyHintGuest")}
        </p>
      </div>
    </div>
  );
}
