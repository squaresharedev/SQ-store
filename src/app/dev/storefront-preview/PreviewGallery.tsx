"use client";

import { helpTextClass } from "@/components/ui/control-styles";
import { cardClass } from "@/components/ui/surface-styles";
import { cn } from "@/lib/utils";
import { pageShellClass } from "@/components/ui/surface-styles";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type ShapeKind,
  type StorefrontBlock,
  type StorefrontConfig,
} from "@/types/storefront";
import { StorefrontPreview } from "@/components/storefront/StorefrontPreview";

/**
 * Living reference for the storefront card's preview: every shape of board the
 * schema permits, each rendered in the SAME box the real card uses.
 *
 * The point is the fit behaviour. A preview that crops looks fine on the one
 * storefront the developer happened to have; these are the ones that break it.
 */

const SHAPES: ShapeKind[] = ["square", "circle", "triangle"];

/** Monotonic id source. Placement-derived ids collided (x*100 + y*10 wraps),
 *  which React surfaces as duplicate keys and then duplicates or omits the
 *  offending tiles — measuring a board that is not the one described. */
let nextId = 0;
function fixtureId(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
}

/** A shape block at a placement, so a case reads as coordinates not boilerplate. */
function shape(x: number, y: number, w = 1, h = 1, index = 0): StorefrontBlock {
  return {
    type: "shape",
    id: fixtureId(),
    kind: SHAPES[(x + y + index) % SHAPES.length],
    color: ["#171717", "#a855f7", "#16a34a", "#2563eb"][(x + y) % 4],
    x,
    y,
    w,
    h,
  };
}

/** A specific shape kind at a placement, for the shape showcase cases. */
function shapeOf(
  kind: ShapeKind,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<Extract<StorefrontBlock, { type: "shape" }>> = {},
): StorefrontBlock {
  return { type: "shape", id: fixtureId(), kind, color, x, y, w, h, ...extra };
}

function text(x: number, y: number, w: number, h: number, body: string): StorefrontBlock {
  return {
    type: "text",
    id: fixtureId(),
    text: body,
    variant: "heading",
    align: "left",
    x,
    y,
    w,
    h,
  };
}

/** Product fixtures, so per-tile style cases render real product faces. */
const FIXTURE_PRODUCTS: Product[] = ["Mug", "Print", "Tote", "Candle"].map(
  (title, index) => ({
    id: `00000000-0000-4000-9000-${String(index + 1).padStart(12, "0")}`,
    title,
    description: "",
    price: 12.5 + index,
    currency: "EUR",
    status: "active",
    imageUrl: null,
    digitalFileName: null,
    trackStock: false,
    stockQuantity: null,
    lowStockThreshold: 3,
  }),
);

const PRODUCTS_BY_ID: ReadonlyMap<string, Product> = new Map(
  FIXTURE_PRODUCTS.map((product) => [product.id, product]),
);

function productBlock(
  index: number,
  x: number,
  y: number,
  w = 1,
  h = 1,
  style?: Extract<StorefrontBlock, { type: "product" }>["style"],
): StorefrontBlock {
  return {
    type: "product",
    productId: FIXTURE_PRODUCTS[index].id,
    x,
    y,
    w,
    h,
    ...(style ? { style } : {}),
  };
}

/** Fill a columns x rows board completely with 1x1 shapes. */
function fill(columns: number, rows: number): StorefrontBlock[] {
  const blocks: StorefrontBlock[] = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) blocks.push(shape(x, y, 1, 1));
  }
  return blocks;
}

function config(
  over: Partial<StorefrontConfig["theme"]>,
  blocks: StorefrontBlock[],
  header?: StorefrontConfig["header"],
): StorefrontConfig {
  return {
    ...DEFAULT_STOREFRONT_CONFIG,
    theme: { ...DEFAULT_STOREFRONT_CONFIG.theme, ...over },
    blocks,
    ...(header ? { header } : {}),
  };
}

const CASES: { title: string; note: string; config: StorefrontConfig }[] = [
  {
    title: "Empty",
    note: "0 blocks. Should show the bare background, not a broken box.",
    config: config({}, []),
  },
  {
    title: "Single 1x1",
    note: "One block on a full 6x6 canvas. The empty canvas is part of the board, so the block stays small — scale only ever shrinks.",
    config: config({}, [shape(0, 0)]),
  },
  {
    title: "Typical 6x6",
    note: "The common case. Should fill the card width at scale 1.",
    config: config({}, [
      shape(0, 0, 2, 2),
      shape(2, 0, 1, 1),
      shape(3, 0, 3, 2),
      shape(0, 2, 6, 1),
      shape(0, 3, 2, 3),
    ]),
  },
  {
    title: "Tall — 6 x 24, full",
    note: "The case that used to crop: only the top rows were ever visible.",
    config: config({ columns: 6, rows: 24 }, fill(6, 24)),
  },
  {
    title: "Tallest — 6 x 60, full",
    note: "Schema maximum rows. Extreme shrink; must stay legible-ish, not 0.",
    config: config({ columns: 6, rows: 60 }, fill(6, 60).slice(0, 120)),
  },
  {
    title: "Wide — 12 x 3",
    note: "Schema maximum columns, short. Should fit on width with no shrink.",
    config: config({ columns: 12, rows: 3 }, fill(12, 3)),
  },
  {
    title: "Widest + tallest — 12 x 24",
    note: "Both axes large; the smaller scale factor must win.",
    config: config({ columns: 12, rows: 24 }, fill(12, 10)),
  },
  {
    title: "Minimum board — 3 x 2",
    note: "Schema minimum. Big cells, should not overflow.",
    config: config({ columns: 3, rows: 2 }, fill(3, 2)),
  },
  {
    title: "With masthead",
    note: "Header adds variable height above the grid; the fit must include it.",
    config: config({ columns: 6, rows: 8 }, fill(6, 8), {
      show: true,
      name: "Very Long Storefront Name That Wraps Onto Several Lines",
      bio: "A bio long enough to wrap more than once, because the masthead is the variable-height part of the board and the scale has to account for it rather than assume a fixed offset.",
    }),
  },
  {
    title: "Carousel mode",
    note: "Different layout path entirely — a horizontal strip, not the grid.",
    config: config({ displayMode: "carousel" }, fill(6, 1)),
  },
  {
    title: "Max gap (32) — 6 x 12",
    note: "Gaps add to height; the fit must include them.",
    config: config({ columns: 6, rows: 12, gridGap: 32 }, fill(6, 12)),
  },
  {
    title: "Zero gap + round corners",
    note: "Corner radius scales with cell size; check nothing bleeds.",
    config: config({ gridGap: 0, cornerRadius: 24 }, fill(6, 6)),
  },
  {
    title: "Gradient background",
    note: "Background lives on the BOX, so it fills gutters left by shrinking.",
    config: config(
      {
        columns: 6,
        rows: 20,
        background: { kind: "gradient", from: "#a855f7", to: "#2563eb", angle: 160 },
      },
      fill(6, 20),
    ),
  },
  {
    title: "Text blocks",
    note: "Text has intrinsic height; long copy must not push past the box.",
    config: config({ columns: 6, rows: 6 }, [
      text(0, 0, 6, 2, "A heading long enough to wrap across the whole board width"),
      text(0, 2, 3, 2, "Second block"),
      shape(3, 2, 3, 4),
    ]),
  },
  {
    title: "Sparse tall board",
    note: "Rows declared far below the lowest block; grid height follows rows.",
    config: config({ columns: 6, rows: 30 }, [shape(0, 0), shape(5, 29)]),
  },
  {
    title: "Stretched shapes",
    note: "Every block is 2x1 or 1x2 and every shape fills its tile edge to edge, stretching with it: a circle becomes an OVAL, a star a wide star. Rounded keeps uniform corners (a rounded rectangle, cqmin radius, never per-axis).",
    config: config({ columns: 4, rows: 5 }, [
      shapeOf("circle", "#2563eb", 0, 0, 2, 1),
      shapeOf("ring", "#16a34a", 2, 0, 1, 2),
      shapeOf("rounded", "#a855f7", 0, 1, 2, 1),
      shapeOf("star", "#171717", 3, 0, 1, 2),
      shapeOf("hexagon", "#2563eb", 0, 2, 1, 2),
      shapeOf("triangle", "#16a34a", 1, 2, 2, 1),
      shapeOf("diamond", "#a855f7", 1, 3, 2, 1),
      shapeOf("pill", "#171717", 3, 2, 1, 2),
      shapeOf("arrow", "#2563eb", 0, 4, 3, 1),
    ]),
  },
  {
    title: "Shape parameters",
    note: "Adjustable geometry: star points 4/5/8/12 across the top; corner roundness on a hexagon, triangle, star, and square below (the outlined hexagon shows the border following the rounded path).",
    config: config({ columns: 4, rows: 2 }, [
      shapeOf("star", "#171717", 0, 0, 1, 1, { points: 4 }),
      shapeOf("star", "#2563eb", 1, 0, 1, 1),
      shapeOf("star", "#16a34a", 2, 0, 1, 1, { points: 8 }),
      shapeOf("star", "#a855f7", 3, 0, 1, 1, { points: 12 }),
      shapeOf("hexagon", "#2563eb", 0, 1, 1, 1, {
        roundness: 14,
        borderWidth: 4,
        borderColor: "#171717",
      }),
      shapeOf("triangle", "#16a34a", 1, 1, 1, 1, { roundness: 20 }),
      shapeOf("star", "#a855f7", 2, 1, 1, 1, { roundness: 8 }),
      shapeOf("square", "#171717", 3, 1, 1, 1, { roundness: 30 }),
    ]),
  },
  {
    title: "Per-tile styles",
    note: "One board, four looks: theme square, circle override, overlay title, pill tag. Each product tile styles itself; unset fields follow the theme.",
    config: config({ columns: 4, rows: 4, cornerRadius: 0 }, [
      productBlock(0, 0, 0, 2, 2),
      productBlock(1, 2, 0, 2, 2, { cornerRadius: 100, priceTagPosition: "hidden", showTitle: false }),
      productBlock(2, 0, 2, 2, 2, { titleStyle: "overlay", cornerRadius: 24 }),
      productBlock(3, 2, 2, 2, 2, { priceTagStyle: "pill", priceTagPosition: "top-right", priceTagSize: "lg" }),
    ]),
  },
];

/** Renders one case in exactly the box the real storefront card uses. */
function Case({
  title,
  note,
  config: storefront,
  width,
}: {
  title: string;
  note: string;
  config: StorefrontConfig;
  width: number;
}) {
  return (
    <li className={cn(cardClass, "flex flex-col p-4 shadow-sm")}>
      <div
        style={{ width }}
        className="mx-auto aspect-[4/3] overflow-hidden rounded-sm border border-border"
      >
        <StorefrontPreview config={storefront} productsById={PRODUCTS_BY_ID} />
      </div>
      <h3 className="mt-3 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-0.5 font-inter text-sm text-muted-foreground">{note}</p>
    </li>
  );
}

export function PreviewGallery() {
  return (
    <main className={pageShellClass}>
      <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
        Storefront preview — fit cases
      </h1>
      <p className="mt-1 max-w-2xl font-inter text-sm text-muted-foreground">
        Each box is the storefront card&apos;s real preview box (4:3, clipped).
        The whole board should be visible in every one: scaled down when it does
        not fit, never cropped, and never enlarged past its natural size.
      </p>

      <h2 className="mt-8 text-lg font-semibold text-foreground">
        Card width (~300px)
      </h2>
      <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CASES.map((entry) => (
          <Case key={entry.title} {...entry} width={300} />
        ))}
      </ul>

      <h2 className="mt-10 text-lg font-semibold text-foreground">
        Narrow (~160px) — the responsive floor
      </h2>
      <p className={cn(helpTextClass, "mt-1")}>
        Same cases in a much smaller box. The column count must NOT change
        between the two rows: the preview scales instead of reflowing, so both
        show the same board at different sizes.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {CASES.map((entry) => (
          <Case key={entry.title} {...entry} width={160} />
        ))}
      </ul>
    </main>
  );
}
