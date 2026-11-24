"use client";

import { useMemo, useState, type ReactNode } from "react";
import { EmbedFrameView } from "@/components/storefront-page/EmbedFrameView";
import { StorefrontBoard, storefrontSurface } from "@/components/storefront-page/StorefrontBoard";
import { ColorPanel } from "@/components/storefront/ColorPanel";
import { StorefrontPreview } from "@/components/storefront/StorefrontPreview";
import { TextBlockEditor } from "@/components/storefront/TextBlockEditor";
import { ThemePanel } from "@/components/storefront/ThemePanel";
import { TypographySection } from "@/components/storefront/TypographySection";
import { recolourPaletteIn } from "@/lib/storefront/palette";
import { paletteContext } from "@/lib/theme/palette-swatches";
import { ColorTargetProvider } from "@/lib/theme/color-context";
import { resolveColorTarget, type ColorTargetRef } from "@/lib/theme/color-target";
import { cn } from "@/lib/utils";
import { FONT_PAIRINGS, blockKey, type StorefrontConfig, type StorefrontSeller, type TextBlock } from "@/types/storefront";
import type { Product } from "@/types/product";
import type { StorefrontPageData } from "@/types/storefront-page";
import {
  asPage,
  legacyConfig,
  pairingConfig,
  paletteConfig,
  recolouredPaletteConfig,
  textStylesConfig,
  valignConfig,
  type GalleryProducts,
  type GallerySection,
} from "./fixtures";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-mono text-xs uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

/** One buyer's board, as the hosted page draws it (minus its footer). */
function Board({ page, label, wide = false }: { page: StorefrontPageData; label: string; wide?: boolean }) {
  const surface = storefrontSurface(page);
  return (
    <div className={cn("space-y-1", wide && "lg:col-span-2")}>
      <p className="font-mono text-xs text-muted-foreground">{label}</p>
      <div
        className={cn("@container relative isolate w-full rounded-md border border-border p-4", surface.className)}
        style={surface.style}
        data-gallery-board={page.id}
      >
        <StorefrontBoard page={page} displayName={page.name} />
      </div>
    </div>
  );
}

export function EditorTypeGallery({
  section,
  products,
  previewProducts,
  seller,
}: {
  section: GallerySection | null;
  products: GalleryProducts;
  /** The same two products in the shape the designer's tiles take. */
  previewProducts: Product[];
  seller: StorefrontSeller;
}) {
  const show = (name: GallerySection) => section === null || section === name;
  const page = (config: StorefrontConfig, key: string) => asPage(config, products, seller, key);

  return (
    <main className="mx-auto max-w-5xl space-y-10 px-4 py-6">
      <h1 className="text-lg font-semibold">Editor upgrade: type, color and text</h1>

      {show("pairings") && (
        <Section title="Font pairings (grid board, Czech and Polish)">
          <div className="grid gap-6 lg:grid-cols-2">
            {FONT_PAIRINGS.map((pairing) => (
              <Board key={pairing} page={page(pairingConfig(pairing, products), `pairing-${pairing}`)} label={`fontPairing: ${pairing}`} />
            ))}
            <Board page={page(pairingConfig(undefined, products), "pairing-none")} label="no pairing (theme.font sans)" />
          </div>
        </Section>
      )}

      {show("color") && (
        <Section title="Palette: one change recolours the board">
          <div className="grid gap-6 lg:grid-cols-2">
            <Board page={page(paletteConfig(products), "palette-before")} label="palette as stored" />
            <Board
              page={page(recolouredPaletteConfig(products), "palette-after")}
              label="after recolourPalette: accent, background, text, muted"
            />
          </div>
        </Section>
      )}

      {show("text") && (
        <Section title="Saved text styles and vertical alignment">
          <div className="grid gap-6 lg:grid-cols-2">
            <Board page={page(pairingConfig("classic", products), "styles-default")} label="classic, styles at their defaults" />
            <Board page={page(textStylesConfig(products), "styles-saved")} label="classic, textStyles saved" />
            <Board wide page={page(valignConfig(false), "valign-grid")} label="valign top / middle / bottom (grid)" />
            <Board wide page={page(valignConfig(true), "valign-freeform")} label="valign over shapes (freeform, no reflow)" />
          </div>
        </Section>
      )}

      {show("legacy") && (
        <Section title="Legacy board: none of this workstream's fields">
          <Board page={page(legacyConfig(products), "legacy")} label="saved before the upgrade" />
        </Section>
      )}

      {show("panels") && <Panels products={products} previewProducts={previewProducts} />}

      {show("embed") && (
        <Section title="Embed frame and the designer's tiles">
          <div className="space-y-6">
            <div className="overflow-hidden rounded-md border border-border">
              <EmbedFrameView page={page(pairingConfig("editorial", products), "embed-editorial")} />
            </div>
            <div className="h-80 overflow-hidden rounded-md border border-border">
              <StorefrontPreview
                config={pairingConfig("studio", products)}
                productsById={new Map(previewProducts.map((product) => [product.id, product]))}
              />
            </div>
          </div>
        </Section>
      )}
    </main>
  );
}

/**
 * The editor's side of it, live: the palette row and the pickers (palette
 * first), the pairing picker, the text styles (behind More, opened), and a
 * text block's inspector with vertical alignment. A colour provider of the
 * gallery's own stands in for the designer's.
 */
function Panels({ products, previewProducts }: { products: GalleryProducts; previewProducts: Product[] }) {
  const [config, setConfig] = useState<StorefrontConfig>(() => pairingConfig("modern", products));
  const heading = config.blocks.find((block): block is TextBlock => block.type === "text")!;
  const [active, setActive] = useState<ColorTargetRef | null>({ kind: "text-color", blockKey: blockKey(heading) });
  const resolved = active
    ? resolveColorTarget(active, config.theme, config.blocks, config.header ?? { show: false, name: "", bio: "" })
    : null;
  const palette = useMemo(() => paletteContext(config.theme), [config.theme]);

  function pick(ref: ColorTargetRef, hex: string) {
    if (ref.kind === "palette") setConfig((current) => recolourPaletteIn(current, ref.slot, hex));
    if (ref.kind === "text-color") updateText(ref.blockKey, { color: hex });
  }
  function updateText(key: string, patch: Partial<TextBlock>) {
    setConfig((current) => ({
      ...current,
      blocks: current.blocks.map((block) => (block.type === "text" && blockKey(block) === key ? { ...block, ...patch } : block)),
    }));
  }
  const setTheme = (theme: StorefrontConfig["theme"]) => setConfig((current) => ({ ...current, theme }));

  return (
    <ColorTargetProvider value={{ activeRef: active, open: setActive, close: () => setActive(null), ...palette }}>
      <Section title="Panels (palette first, pairing picker, text styles, inspector)">
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 rounded-md border border-border p-4">
            <ThemePanel theme={config.theme} onChange={setTheme} backgroundImageUrl={null} onBackgroundImageChange={() => {}} />
          </div>
          <div className="rounded-md border border-border">
            {resolved && active ? (
              <ColorPanel
                key={JSON.stringify(active)}
                target={resolved}
                inDesign={[]}
                onPick={(hex) => pick(active, hex)}
                onInherit={active.kind === "text-color" ? () => updateText(active.blockKey, { color: undefined }) : undefined}
                onClose={() => setActive(null)}
              />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">Open a colour field to see the panel.</p>
            )}
          </div>
          <div className="space-y-6 rounded-md border border-border p-4">
            <TypographySection theme={config.theme} onChange={setTheme} fontUrl={null} onFontUrlChange={() => {}} />
          </div>
          <div className="rounded-md border border-border p-4">
            <TextBlockEditor
              block={heading}
              accent={config.theme.accent}
              textStyles={config.theme.textStyles}
              onUpdate={(patch) => updateText(blockKey(heading), patch)}
              onDuplicate={() => {}}
            />
          </div>
          <div className="h-96 overflow-hidden rounded-md border border-border lg:col-span-2">
            <StorefrontPreview
              config={config}
              productsById={new Map(previewProducts.map((product) => [product.id, product]))}
            />
          </div>
        </div>
      </Section>
    </ColorTargetProvider>
  );
}
