import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "../setup/render";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type CardStyleOverrides,
  type ImageBlock,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontTheme,
} from "@/types/storefront";
import { ProductTileContent } from "@/components/storefront/ProductTileContent";
import { ImageTileContent } from "@/components/storefront/ImageTileContent";
import { blockTileClipStyle, tileFrameClass } from "@/components/storefront/config-maps";

/**
 * THE ABSENT PATH, PINNED (Photo cards, editor upgrade).
 *
 * A storefront saved before the card look existed must draw exactly as it
 * did: these are live on sellers' own websites. Every fixture below uses only
 * fields that existed before the upgrade, and the snapshot beside this file
 * was taken from the renderer BEFORE the card look was written, so any change
 * to the DOM a legacy card draws shows up here as a diff.
 *
 * One change is deliberate and normalised away: the readable floor on the two
 * tile labels (the first number of each label size's clamp), which is one of
 * the two "Fix" items and is pinned on its own in photo-cards.test.tsx.
 */

afterEach(cleanup);

const theme = (over: Partial<StorefrontTheme> = {}): StorefrontTheme => ({
  ...structuredClone(DEFAULT_STOREFRONT_CONFIG.theme),
  ...over,
});

const PRODUCT: Product = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  title: "Speckled mug",
  description: "",
  price: 12.5,
  currency: "EUR",
  status: "active",
  imageUrl: "https://images.test.invalid/mug.jpg",
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 3,
  maxPerOrder: 10,
};

type Fixture = {
  name: string;
  theme?: Partial<StorefrontTheme>;
  overrides?: CardStyleOverrides;
  product?: Partial<Product>;
  soldOut?: boolean;
  placement?: ProductBlock["imagePlacement"];
};

const CARDS: Fixture[] = [
  { name: "default theme" },
  {
    name: "overlay at the top, on hover, a coloured floated tag",
    theme: { titleStyle: "overlay", titlePosition: "top-left", titleDisplay: "hover" },
    overrides: { priceTagPosition: "bottom-right", priceTagColor: "#fbbf24", priceTagTextColor: "#1c1917", priceTagBorderWidth: 2, priceTagBorderColor: "#d97706" },
  },
  {
    name: "shadow with its own shade and frost, price below",
    theme: { titleStyle: "shadow", titleShadowColor: "#1e3a8a", titleShadowBlur: 40 },
  },
  { name: "plain shadow", theme: { titleStyle: "shadow", priceTagPosition: "top-right" } },
  {
    name: "sold out and very round",
    theme: { cornerRadius: 40, titleStyle: "overlay", titlePosition: "middle-center" },
    soldOut: true,
  },
  {
    name: "on sale, chips the size of a cell",
    theme: { chipScale: "cell", saleBadge: "percent", priceTagPosition: "top-left" },
    product: { sale: { price: 10, offerPercent: 20 } },
  },
  {
    name: "every card extra",
    theme: { hoverEffect: "zoom", hoverPhoto: true, buyButton: "outline", showRating: true, showLowStock: true },
    product: { hoverImageUrl: "https://images.test.invalid/mug-b.jpg", rating: { average: 4.5, count: 8 }, trackStock: true, stockQuantity: 2 },
  },
  { name: "no photo", product: { imageUrl: null } },
  {
    name: "framed and blurred from the top",
    theme: { photoBlur: 30, photoBlurDirection: "top" },
    placement: { x: 30, y: 70, scale: 140 },
  },
  {
    name: "own buy button, bar on top",
    theme: { titlePosition: "top-center", buyButton: "solid", buyButtonColor: "#0b3d2e", buyButtonTextColor: "#ffd166", titleInset: 6 },
  },
  { name: "link buy button, no title", theme: { showTitle: false, buyButton: "link" } },
];

const IMAGE: ImageBlock = {
  type: "image",
  id: "eeeeeeee-ffff-4aaa-8bbb-cccccccccccc",
  key: "elements/a/b-logo.png",
  alt: "Logo",
  x: 0,
  y: 0,
  w: 2,
  h: 1,
};

const SHAPE: ShapeBlock = {
  type: "shape",
  id: "dddddddd-eeee-4fff-8aaa-bbbbbbbbbbbb",
  kind: "circle",
  color: "#fbbf24",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

/** The label sizes' floors are the one intended change (see above). */
function normalise(html: string): string {
  return html.replace(/clamp\([\d.]+px, (?=[\d.]+cqmin|calc\(var\(--ss-cell\))/g, "clamp(FLOOR, ");
}

describe("a legacy card draws exactly as before the card look", () => {
  it("draws the same product faces", async () => {
    const out: string[] = [];
    for (const fixture of CARDS) {
      const { container } = render(
        <ProductTileContent
          product={{ ...PRODUCT, ...fixture.product }}
          theme={theme(fixture.theme)}
          overrides={fixture.overrides}
          soldOut={fixture.soldOut}
          imagePlacement={fixture.placement}
        />,
      );
      out.push(`<!-- ${fixture.name} -->\n${normalise(container.innerHTML)}`);
      cleanup();
    }
    await expect(out.join("\n\n")).toMatchFileSnapshot("./__snapshots__/photo-cards-legacy-products.html");
  });

  it("draws the same image faces", async () => {
    const out: string[] = [];
    for (const [name, block, src] of [
      ["cover", IMAGE, "https://images.test.invalid/logo.png"],
      ["cover, framed, half see-through", { ...IMAGE, imagePlacement: { x: 20, y: 40, scale: 150 }, opacity: 50 }, "https://images.test.invalid/logo.png"],
      ["contain", { ...IMAGE, fit: "contain" }, "https://images.test.invalid/logo.png"],
      ["no artwork yet", IMAGE, null],
    ] as const) {
      const { container } = render(<ImageTileContent block={block as ImageBlock} src={src} />);
      out.push(`<!-- ${name} -->\n${container.innerHTML}`);
      cleanup();
    }
    await expect(out.join("\n\n")).toMatchFileSnapshot("./__snapshots__/photo-cards-legacy-images.html");
  });

  it("clips and frames every kind of cell the same", async () => {
    const t = theme({ cornerRadius: 12, titleStyle: "shadow", hoverEffect: "lift" });
    const product: ProductBlock = { type: "product", productId: PRODUCT.id, x: 0, y: 0, w: 2, h: 2 };
    const covered = blockTileClipStyle(t, SHAPE, { w: 1, h: 1 }, [{ key: "p_x", cornerRadius: 20 }]);
    await expect(
      JSON.stringify(
        {
          product: blockTileClipStyle(t, product, { w: 2, h: 2 }, undefined),
          roundProduct: blockTileClipStyle(t, { ...product, style: { cornerRadius: 30 } }, { w: 2, h: 2 }, undefined),
          image: blockTileClipStyle(t, IMAGE, { w: 2, h: 1 }, undefined),
          shape: blockTileClipStyle(t, SHAPE, { w: 1, h: 1 }, undefined),
          covered,
          frames: [tileFrameClass(product), tileFrameClass(IMAGE), tileFrameClass(SHAPE)],
        },
        null,
        2,
      ),
    ).toMatchFileSnapshot("./__snapshots__/photo-cards-legacy-cells.json");
  });
});
