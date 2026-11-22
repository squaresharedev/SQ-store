"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Product } from "@/types/product";
import {
  DEFAULT_STOREFRONT_CONFIG,
  blockKey,
  type CardStyleOverrides,
  type ImageBlock,
  type PhotoEdge,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontTheme,
} from "@/types/storefront";
import type { StorefrontPageData } from "@/types/storefront-page";
import { resolveTileLook } from "@/lib/storefront/tile-look";
import { cachedPhotoEdge } from "@/lib/storefront/photo-edge";
import { FONT_ROLE_VARS } from "@/lib/theme/font-roles";
import { cn } from "@/lib/utils";
import { StorefrontBoard, storefrontSurface } from "@/components/storefront-page/StorefrontBoard";
import { StorefrontPreview } from "@/components/storefront/StorefrontPreview";
import { CardsSection } from "@/components/storefront/CardsSection";
import { ImageBlockEditor, type ImageBlockPatch } from "@/components/storefront/ImageBlockEditor";
import { ShapeBlockEditor, type ShapeBlockPatch } from "@/components/storefront/ShapeBlockEditor";
import { GALLERY_SECTIONS, type GallerySection } from "./sections";

/**
 * THE PHOTO CARDS GALLERY (see page.dev.tsx). Fixtures only: raw colours are
 * allowed here, nowhere else.
 */

const PHOTOS = ["camera", "headphones", "watch", "mouse", "speaker", "succulent"] as const;
type Photo = (typeof PHOTOS)[number];

const TITLES: Record<Photo, string> = {
  camera: "Instant camera",
  headphones: "Studio headphones",
  watch: "Smart watch",
  mouse: "Wireless mouse",
  speaker: "Travel speaker",
  succulent: "Zebra succulent",
};
const PRICES: Record<Photo, number> = { camera: 119, headphones: 89, watch: 249, mouse: 39, speaker: 79, succulent: 18 };

const id = (photo: Photo) => `00000000-0000-4000-8000-0000000000${String(PHOTOS.indexOf(photo) + 1).padStart(2, "0")}`;

const PRODUCTS: Product[] = PHOTOS.map((photo) => ({
  id: id(photo),
  title: TITLES[photo],
  description: "",
  price: PRICES[photo],
  currency: "EUR",
  status: "active",
  imageUrl: `/sample-storefront/${photo}.webp`,
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 3,
  maxPerOrder: 10,
}));
const PRODUCTS_BY_ID = new Map(PRODUCTS.map((product) => [product.id, product]));

/** A coloured board with today's cards: what the workstream exists to fix. */
const SAGE: StorefrontTheme = {
  ...DEFAULT_STOREFRONT_CONFIG.theme,
  background: { kind: "solid", color: "#dfe6d6" },
  accent: "#23402e",
  columns: 6,
  rows: 4,
  cornerRadius: 10,
  gridGap: 12,
  titleDisplay: "always",
  priceDisplay: "always",
};

/** The same board, with the card look. */
const SAGE_CARDS: StorefrontTheme = { ...SAGE, cardColor: "#f6f2ea", whiteBlend: "auto" };

const ROW = (photos: readonly Photo[], y: number, size = 2, style?: (photo: Photo, index: number) => CardStyleOverrides | undefined): ProductBlock[] =>
  photos.map((photo, index) => {
    const own = style?.(photo, index);
    return { type: "product", productId: id(photo), x: index * size, y, w: size, h: size, ...(own ? { style: own } : {}) };
  });

const SIX: ProductBlock[] = [...ROW(["camera", "headphones", "watch"], 0), ...ROW(["mouse", "speaker", "succulent"], 2)];

const image = (key: string, x: number, y: number, over: Partial<ImageBlock> = {}): ImageBlock => ({
  type: "image",
  id: `10000000-0000-4000-8000-0000000000${key}`,
  key: `elements/gallery/${key}.webp`,
  alt: "",
  x,
  y,
  w: 2,
  h: 2,
  ...over,
});

const shape = (key: string, x: number, y: number, over: Partial<ShapeBlock> = {}): ShapeBlock => ({
  type: "shape",
  id: `20000000-0000-4000-8000-0000000000${key}`,
  kind: "circle",
  color: "#e9a23b",
  x,
  y,
  w: 2,
  h: 2,
  ...over,
});

/** A buyer's page for a theme and its blocks, as buildStorefrontPage hands it. */
function pageFor(theme: StorefrontTheme, blocks: StorefrontBlock[], imageUrls: Record<string, string> = {}): StorefrontPageData {
  return {
    id: "gallery",
    name: "Gallery",
    theme,
    blocks,
    products: PRODUCTS.map((product) => ({
      id: product.id,
      title: product.title,
      price: product.price,
      currency: product.currency,
      imageUrl: product.imageUrl,
      href: "#",
    })),
    tileLook: resolveTileLook({ theme }),
    imageUrls,
    backgroundImageUrl: null,
    customFontUrl: null,
    seller: {} as StorefrontPageData["seller"],
    allowIndexing: false,
    url: "#",
  };
}

/** One board as a buyer sees it, on its own background. */
function Board({ page, label, style }: { page: StorefrontPageData; label: string; style?: CSSProperties }) {
  const surface = storefrontSurface(page);
  return (
    <div
      className={cn("@container relative isolate rounded-md p-4", surface.className)}
      style={{ ...surface.style, ...style }}
      data-gallery-board={label}
    >
      <StorefrontBoard page={page} displayName={label} />
    </div>
  );
}

function Section({ id: sectionId, title, note, children }: { id: GallerySection; title: string; note: string; children: ReactNode }) {
  return (
    <section className="space-y-3" data-gallery-section={sectionId}>
      <header className="space-y-1">
        <h2 className="font-inter text-lg font-semibold text-foreground">{title}</h2>
        <p className="max-w-3xl font-inter text-sm text-muted-foreground">{note}</p>
      </header>
      {children}
    </section>
  );
}

/** Stand-ins for a font pairing's two faces, so "Name font" shows a change
 *  here without the pairing module (another workstream's). */
const PAIRING_STAND_IN = {
  [FONT_ROLE_VARS.heading]: "Georgia, serif",
  [FONT_ROLE_VARS.body]: "inherit",
} as CSSProperties;

export function EditorCardsGallery({ only }: { only: readonly GallerySection[] | null }) {
  const show = (section: GallerySection) => only === null || only.includes(section);

  // THE DESIGNER'S MEASUREMENT, run here on the same photos: what each
  // product's edge is, or null where it cannot be read.
  const [edges, setEdges] = useState<Record<string, PhotoEdge | null> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(PRODUCTS.map(async (product) => [product.id, await cachedPhotoEdge(product, true)] as const)).then(
      (results) => {
        if (!cancelled) setEdges(Object.fromEntries(results));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  /** The blocks with the measured edge cached on them, as a saved board has. */
  const measured = (blocks: StorefrontBlock[]): StorefrontBlock[] =>
    blocks.map((block) => {
      const edge = block.type === "product" ? edges?.[block.productId] : null;
      return block.type === "product" && edge ? { ...block, photoEdge: edge } : block;
    });

  // The panels' own board, driven by the controls under it.
  const [panelTheme, setPanelTheme] = useState<StorefrontTheme>({ ...SAGE_CARDS, columns: 8, rows: 2 });
  const [panelImage, setPanelImage] = useState<ImageBlock>(image("31", 0, 0, { shape: "arch", shadow: "soft" }));
  const [panelShape, setPanelShape] = useState<ShapeBlock>(shape("32", 2, 0, { kind: "star", shadow: "soft" }));
  const panelBlocks = useMemo<StorefrontBlock[]>(
    () => [...ROW(["headphones", "watch"], 0).map((block, index) => ({ ...block, x: 4 + index * 2, w: 2 })), panelImage, panelShape],
    [panelImage, panelShape],
  );
  const succulentArt = (blocks: StorefrontBlock[]) =>
    Object.fromEntries(
      blocks.filter((block) => block.type === "image").map((block) => [blockKey(block), "/sample-storefront/succulent.webp"]),
    );

  const blendConfig: StorefrontConfig = { ...DEFAULT_STOREFRONT_CONFIG, theme: SAGE_CARDS, blocks: measured(SIX) };

  return (
    <main className="mx-auto max-w-6xl space-y-12 bg-background px-4 py-8" data-measured={edges ? "" : undefined}>
      <header className="space-y-1">
        <h1 className="font-inter text-2xl font-semibold text-foreground">Photo cards</h1>
        <p className="font-inter text-sm text-muted-foreground">
          Sections: {GALLERY_SECTIONS.join(", ")}. Add ?only=blend,shapes for a subset.
        </p>
      </header>

      {show("measured") && (
        <Section
          id="measured"
          title="Measured in the browser, as the designer does"
          note="Each photo shrunk to 48 px and its border read: white when most of the ring is near-white. A photo that cannot be read is never blended."
        >
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {PRODUCTS.map((product) => (
              <li key={product.id} className="space-y-1 font-inter text-xs text-foreground">
                {/* eslint-disable-next-line @next/next/no-img-element -- a fixture thumbnail */}
                <img src={product.imageUrl!} alt="" className="aspect-square w-full rounded-sm object-cover" />
                <span data-edge={edges?.[product.id] ?? "pending"}>
                  {product.title}: <strong>{edges ? (edges[product.id] ?? "unreadable") : "measuring"}</strong>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {show("legacy") && (
        <Section
          id="legacy"
          title="Legacy board: none of the new fields"
          note="A coloured board with today's cards. Studio photos read as white boxes. This board must render exactly as before the upgrade (bar 'Fix' label floors)."
        >
          <Board label="legacy" page={pageFor(SAGE, SIX)} />
        </Section>
      )}

      {show("blend") && (
        <Section
          id="blend"
          title="Card color + Blend white background: Auto"
          note="The same board with a card colour and Auto. White-edged photos sit on the card; the camera (grey wall) and the speaker (a room) are left alone."
        >
          <Board label="blend-auto" page={pageFor(SAGE_CARDS, measured(SIX))} />
          <div className="grid gap-4 md:grid-cols-2">
            <Board
              label="blend-on-blush"
              page={pageFor(
                { ...SAGE, background: { kind: "solid", color: "#f2ddd5" }, accent: "#7a2e1d", rows: 2, cardColor: "#fbf3ee", whiteBlend: "on" },
                ROW(["mouse", "succulent", "headphones"], 0),
              )}
            />
            <Board
              label="blend-on-dark-card"
              page={pageFor(
                { ...SAGE, background: { kind: "solid", color: "#c9d3e0" }, rows: 2, cardColor: "#1f2a44", whiteBlend: "on" },
                ROW(["mouse", "succulent", "headphones"], 0),
              )}
            />
          </div>
        </Section>
      )}

      {show("strip") && (
        <Section
          id="strip"
          title="Name strip: its colour, an ink that reads, and the headline face"
          note="Dark strip with automatic light ink and the headline face (a stand-in pairing); an overlay strip in the card colour; a seller's own name colour; a buy row on the card colour."
        >
          <div style={PAIRING_STAND_IN}>
            <Board
              label="strip"
              page={pageFor(
                { ...SAGE_CARDS, rows: 2, buyButton: "outline" },
                measured(
                  ROW(["succulent", "headphones", "watch"], 0, 2, (_photo, index) =>
                    index === 0
                      ? { titleBarColor: "#23402e", titleFont: "heading" }
                      : index === 1
                        ? { titleStyle: "overlay", titleBarColor: "#f6f2ea", titleFont: "heading" }
                        : { titleTextColor: "#9a3412" },
                  ),
                ),
              )}
            />
          </div>
        </Section>
      )}

      {show("shapes") && (
        <Section
          id="shapes"
          title="Photo shapes: Rectangle, Rounded, Arch, Circle"
          note="On cards (the photo sits on the card, in from its edges) and on image blocks (the picture is the block)."
        >
          {(() => {
            const shapes = ["rectangle", "rounded", "arch", "circle"] as const;
            const cards = ROW(["succulent", "headphones", "mouse", "watch"], 0, 2, (_photo, index) => ({ photoShape: shapes[index] }));
            const images = shapes.map((outline, index) => image(`4${index}`, index * 2, 2, { shape: outline }));
            const blocks = measured([...cards, ...images]);
            return <Board label="shapes" page={pageFor({ ...SAGE_CARDS, columns: 8, rows: 4 }, blocks, succulentArt(blocks))} />;
          })()}
        </Section>
      )}

      {show("shadows") && (
        <Section
          id="shadows"
          title="Shadows: None, Soft, Lifted"
          note="Cards, images and shapes. Drawn by the grid cell, outside the tile's clip, so a circle's shadow is round."
        >
          {(() => {
            const presets = ["none", "soft", "lifted"] as const;
            const cards = ROW(["succulent", "headphones", "mouse"], 0, 2, (_photo, index) => ({ shadow: presets[index] }));
            const images = presets.map((preset, index) => image(`5${index}`, index * 2, 2, { shadow: preset === "none" ? undefined : preset, shape: "circle" }));
            const shapes = presets.map((preset, index) =>
              shape(`6${index}`, index * 2, 4, { kind: index === 1 ? "star" : "rounded", shadow: preset === "none" ? undefined : preset }),
            );
            const blocks = measured([...cards, ...images, ...shapes]);
            return (
              <Board
                label="shadows"
                page={pageFor({ ...SAGE_CARDS, background: { kind: "solid", color: "#f1efe9" }, rows: 6 }, blocks, succulentArt(blocks))}
              />
            );
          })()}
        </Section>
      )}

      {show("shadowFix") && (
        <Section
          id="shadowFix"
          title="Fix: a shadow title over a white photo"
          note="Left: not measured, as every storefront is today (a muddy grey fade). Right: measured; white-edged photos get a pale fade with dark words, the camera keeps its dark fade."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Board
              label="shadow-before"
              page={pageFor({ ...SAGE, titleStyle: "shadow", rows: 4, columns: 4 }, ROW(["headphones", "succulent"], 0).concat(ROW(["camera"], 2)))}
            />
            <Board
              label="shadow-after"
              page={pageFor(
                { ...SAGE, titleStyle: "shadow", rows: 4, columns: 4 },
                measured(ROW(["headphones", "succulent"], 0).concat(ROW(["camera"], 2))),
              )}
            />
          </div>
        </Section>
      )}

      {show("labels") && (
        <Section
          id="labels"
          title="Fix: the price and the name never go under a readable size"
          note="Ten columns of 1x1 cards with chips the size of one cell (chipScale cell, now only offered to boards already on it). Labels used to fall to 8 to 9 px here."
        >
          <Board
            label="labels"
            page={pageFor(
              { ...SAGE_CARDS, columns: 10, rows: 2, chipScale: "cell", priceTagPosition: "top-right" },
              measured([
                ...PHOTOS.slice(0, 5).map((photo, index): ProductBlock => ({ type: "product", productId: id(photo), x: index, y: 0, w: 1, h: 1 })),
                { type: "product", productId: id("succulent"), x: 5, y: 0, w: 2, h: 2 },
              ]),
            )}
          />
        </Section>
      )}

      {show("freeform") && (
        <Section
          id="freeform"
          title="Freeform: a tilted card on a shape"
          note="A board with a tilt keeps its columns on a phone. The shadow turns with the card."
        >
          <Board
            label="freeform"
            page={pageFor(
              { ...SAGE_CARDS, rows: 3, shadow: "lifted" },
              measured([
                shape("70", 0, 0, { kind: "rounded", color: "#23402e", w: 3, h: 3 }),
                { type: "product", productId: id("succulent"), x: 0, y: 0, w: 2, h: 2, rotation: -6, z: 2 } as ProductBlock,
                { type: "product", productId: id("headphones"), x: 3, y: 0, w: 3, h: 3, style: { photoShape: "arch" } },
              ]),
            )}
          />
        </Section>
      )}

      {show("canvas") && (
        <Section
          id="canvas"
          title="The designer's tiles"
          note="The blend board through StorefrontPreview, which draws the designer's own tiles (BlockTile), scaled to fit."
        >
          <div className="h-[28rem] overflow-hidden rounded-md border border-border">
            <StorefrontPreview config={blendConfig} productsById={PRODUCTS_BY_ID} className="h-full" />
          </div>
        </Section>
      )}

      {show("panels") && (
        <Section
          id="panels"
          title="The panels"
          note="Product cards > Card style (theme scope) shows Card color and Blend white background; the rest is behind More. The image and shape inspectors gain Shape and Shadow. They drive the board."
        >
          <Board label="panels" page={pageFor(panelTheme, measured(panelBlocks), succulentArt(panelBlocks))} />
          <div className="flex flex-wrap items-start gap-6">
            <div className="w-80 rounded-md border border-border bg-background p-4" data-gallery-panel="cards">
              <CardsSection theme={panelTheme} onChange={setPanelTheme} />
            </div>
            <div className="w-80 rounded-md border border-border bg-background p-4" data-gallery-panel="image">
              <ImageBlockEditor
                block={panelImage}
                canFrame={false}
                onUpdate={(patch: ImageBlockPatch) => setPanelImage((current) => ({ ...current, ...patch }))}
                onFrame={() => {}}
                onDuplicate={() => {}}
                onRemove={() => {}}
              />
            </div>
            <div className="w-80 rounded-md border border-border bg-background p-4" data-gallery-panel="shape">
              <ShapeBlockEditor
                block={panelShape}
                onUpdate={(patch: ShapeBlockPatch) => setPanelShape((current) => ({ ...current, ...patch }))}
                onDuplicate={() => {}}
                onRemove={() => {}}
              />
            </div>
          </div>
        </Section>
      )}
    </main>
  );
}
