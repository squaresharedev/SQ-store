"use client";

import { useMemo, useState } from "react";
import { helpTextClass } from "@/components/ui/control-styles";
import { ToastProvider } from "@/components/ui/Toast";
import type { Product } from "@/types/product";
import { ControlsPanel } from "@/components/storefront/ControlsPanel";
import { editorEntries } from "@/components/storefront/editor-search";
import { ImageBlockEditor } from "@/components/storefront/ImageBlockEditor";
import { LayersPanel } from "@/components/storefront/LayersPanel";
import { MultiBlockEditor } from "@/components/storefront/MultiBlockEditor";
import { PlacementSection } from "@/components/storefront/PlacementSection";
import { SettingTargetProvider } from "@/lib/storefront/setting-context";
import type { SettingRef } from "@/lib/storefront/setting-ref";
import { ProductBlockEditor } from "@/components/storefront/ProductBlockEditor";
import { ShapeBlockEditor } from "@/components/storefront/ShapeBlockEditor";
import { TextBlockEditor } from "@/components/storefront/TextBlockEditor";
import { DEFAULT_PRODUCT_PAGE_CONFIG as PRODUCT_PAGE_DEFAULTS } from "@/types/storefront";
import {
  DEFAULT_STOREFRONT_CONFIG,
  type ImageBlock,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontHeader,
  type TextBlock,
} from "@/types/storefront";

/**
 * Living reference for the designer's side-panel navigation.
 *
 * The panels are the hardest part of the editor to reach in a test: they need a
 * saved storefront, a selection, and a canvas behind them. Here they are mounted
 * on fixtures instead, at the real 320px width, so the group menu, the submenus
 * and every block inspector can be read side by side. Dev-only.
 */

const THEME = DEFAULT_STOREFRONT_CONFIG.theme;

const HEADER: StorefrontHeader = {
  show: true,
  name: "Fixture Goods",
  bio: "Everything here is a stand-in.",
};

const PRODUCT_BLOCK: ProductBlock = {
  type: "product",
  productId: "00000000-0000-4000-8000-0000000000a1",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

const TEXT_BLOCK: TextBlock = {
  type: "text",
  id: "00000000-0000-4000-8000-0000000000b1",
  text: "Sample heading",
  variant: "heading",
  align: "left",
  x: 0,
  y: 0,
  w: 2,
  h: 1,
};

const SHAPE_BLOCK: ShapeBlock = {
  type: "shape",
  id: "00000000-0000-4000-8000-0000000000c1",
  kind: "circle",
  color: "#e11d48",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

const IMAGE_BLOCK: ImageBlock = {
  type: "image",
  id: "00000000-0000-4000-8000-0000000000d1",
  key: "fixture/image.png",
  alt: "A fixture image",
  x: 0,
  y: 0,
  w: 1,
  h: 1,
};

/** A second shape, so the placement section has a stack to reason about:
 *  with one block on the board every layer control is correctly disabled, and
 *  a row of four dead buttons proves nothing. */
const SHAPE_BEHIND: ShapeBlock = {
  type: "shape",
  id: "00000000-0000-4000-8000-0000000000c2",
  kind: "square",
  color: "#0ea5e9",
  x: 1,
  y: 0,
  w: 1,
  h: 1,
  z: 0,
};

const PRODUCT: Product = {
  id: PRODUCT_BLOCK.productId,
  title: "Fixture product",
  description: "",
  price: 24,
  currency: "EUR",
  status: "active",
  imageUrl: null,
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 3,
};

/** The catalogue the product tile resolves its name through. */
const PRODUCTS_BY_ID = new Map([[PRODUCT.id, PRODUCT]]);

/** The panel column at its real docked width, so wrapping and truncation show
 *  up here exactly as they do in the editor. */
function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="font-inter text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <p className={helpTextClass}>{note}</p>
      <div className="w-[20rem] border border-border bg-background">
        {children}
      </div>
    </section>
  );
}

export function PanelsGallery() {
  const [theme, setTheme] = useState(THEME);
  // The designer owns this for real; the gallery stands in for it so the
  // find-a-setting field can be exercised end to end without auth.
  const [settingRef, setSettingRef] = useState<SettingRef | null>(null);
  const [header, setHeader] = useState(HEADER);
  const [showGrid, setShowGrid] = useState(false);
  const [shape, setShape] = useState(SHAPE_BLOCK);
  const [text, setText] = useState(TEXT_BLOCK);
  const [image, setImage] = useState(IMAGE_BLOCK);

  // Whether the index is built as if a product page were out on the canvas.
  // There is no canvas here, so this stands in for one: the product page's
  // settings are gated on the page being on screen, and both halves of that
  // gate have to be readable side by side to be worth anything.
  const [pageOpen, setPageOpen] = useState(false);

  // The editor's search index over the SAME fixtures the inspectors below use,
  // so the field can be exercised on all three of the things it finds:
  // settings, objects on the board, and the drawers. The designer holds live
  // state here; the gallery holds four blocks that never move.
  const searchEntries = useMemo(
    () =>
      editorEntries([PRODUCT_BLOCK, text, shape, image], PRODUCTS_BY_ID, {
        pageOpen,
      }),
    [text, shape, image, pageOpen],
  );
  // Standing in for the editor, which selects the block or opens the drawer.
  // Shown rather than performed: there is no canvas here to select on.
  const [jumped, setJumped] = useState<string | null>(null);

  return (
    <ToastProvider>
    <SettingTargetProvider
      value={{
        activeRef: settingRef,
        open: setSettingRef,
        close: () => setSettingRef(null),
      }}
    >
      <main className="mx-auto max-w-5xl space-y-10 p-6 sm:p-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            Storefront panels
          </h1>
          <p className={helpTextClass}>
            The design panel opens on a menu of six groups rather than every
            control at once. Open one to see its submenu, and use the back row to
            leave. Product cards keeps card style and price tag together, because
            the roundness in one decides where the tag in the other may sit.
          </p>
        </header>

        <Panel
          title="Design panel"
          note="Global settings. Six groups, one level deep."
        >
          {/* The gate, switchable, because the search field answers a product
              page query two different ways depending on it: control by control
              with a page out, and with a single "Open the product page" row
              without one. Try "photo fit" either side of this. */}
          <label className="mb-3 flex items-center gap-2 lg:px-4">
            <input
              type="checkbox"
              checked={pageOpen}
              onChange={(event) => setPageOpen(event.target.checked)}
            />
            <span className={helpTextClass}>
              A product page is open on the canvas
            </span>
          </label>
          <ControlsPanel
            theme={theme}
            header={header}
            onThemeChange={setTheme}
            onHeaderChange={setHeader}
            onCanvasChange={(columns, rows) =>
              setTheme((current) => ({ ...current, columns, rows }))
            }
            backgroundImageUrl={null}
            onBackgroundImageChange={() => {}}
            customFontUrl={null}
            onCustomFontUrlChange={() => {}}
            showGrid={showGrid}
            onShowGridChange={setShowGrid}
            productPage={PRODUCT_PAGE_DEFAULTS}
            onProductPageChange={() => {}}
            shippingPolicy={{}}
            sellerIdentity={{}}
            searchEntries={searchEntries}
            onJump={(target) =>
              setJumped(
                target.kind === "block"
                  ? `select block ${target.key}`
                  : `open the ${target.panel} panel`,
              )
            }
          />
        </Panel>
        {jumped && (
          <p className={helpTextClass} role="status">
            The editor would: {jumped}
          </p>
        )}

        <Panel
          title="Product inspector"
          note="Tile style and price tag are collapsed groups; the product's own name and price stay at the top."
        >
          <div className="p-4">
            <ProductBlockEditor
              block={PRODUCT_BLOCK}
              theme={theme}
              product={PRODUCT}
              onStyleChange={() => {}}
              onStyleReset={() => {}}
              onRemove={() => {}}
              onProductSaved={() => {}}
              pageOpen={pageOpen}
              onDesignPage={() => setPageOpen((open) => !open)}
            />
          </div>
        </Panel>

        <Panel
          title="Placement"
          note="Every kind of block has an angle and a place in the stack, so this section is shared by all four inspectors. The four layer moves are icons, and their hover labels are the shared tooltip."
        >
          <div className="p-4">
            <PlacementSection
              blocks={[shape]}
              board={[shape, SHAPE_BEHIND]}
              onRotate={(degrees) =>
                setShape((current) => ({ ...current, rotation: degrees }))
              }
              onReorder={(op) => setJumped(`reorder the selection: ${op}`)}
              onOpenLayers={() => setJumped("open the layers list")}
            />
          </div>
        </Panel>

        <Panel
          title="Layers"
          note="The whole stack, front at the top. Each row expands onto the same four moves, wearing the same tooltips."
        >
          <LayersPanel
            blocks={[PRODUCT_BLOCK, text, shape, image]}
            productsById={PRODUCTS_BY_ID}
            elementUrls={{}}
            selectedKeys={[]}
            onSelect={(key) => setJumped(`select block ${key}`)}
            onReorder={(key, op) => setJumped(`reorder ${key}: ${op}`)}
            onMoveTo={(key, index) => setJumped(`move ${key} to ${index}`)}
            onBack={() => setJumped("leave the layers list")}
          />
        </Panel>

        <Panel
          title="Text inspector"
          note="Under budget, so it stays flat: eight controls with no group worth hiding."
        >
          <div className="p-4">
            <TextBlockEditor
              block={text}
              accent={theme.accent}
              onUpdate={(patch) =>
                setText((current) => ({ ...current, ...patch }))
              }
              onDuplicate={() => {}}
              onEditText={() => {}}
            />
          </div>
        </Panel>

        <Panel
          title="Shape inspector"
          note="Nine line items, but the conditional ones mean at most five render at once."
        >
          <div className="p-4">
            <ShapeBlockEditor
              block={shape}
              onUpdate={(patch) =>
                setShape((current) => ({ ...current, ...patch }))
              }
              onDuplicate={() => {}}
              onRemove={() => {}}
            />
          </div>
        </Panel>

        <Panel title="Image inspector" note="Six controls, flat.">
          <div className="p-4">
            <ImageBlockEditor
              block={image}
              canFrame={false}
              onUpdate={(patch) =>
                setImage((current) => ({ ...current, ...patch }))
              }
              onFrame={() => {}}
              onDuplicate={() => {}}
              onRemove={() => {}}
            />
          </div>
        </Panel>

        <Panel
          title="Multi-select inspector"
          note="Two product tiles: the same two groups a single tile gets."
        >
          <div className="p-4">
            <MultiBlockEditor
              blocks={[
                PRODUCT_BLOCK,
                { ...PRODUCT_BLOCK, productId: "00000000-0000-4000-8000-0000000000a2", x: 1 },
              ]}
              theme={theme}
              onProductStyleChange={() => {}}
              onProductStyleReset={() => {}}
              onShapeChange={() => {}}
              onTextChange={() => {}}
              onDuplicate={() => {}}
              onRemove={() => {}}
            />
          </div>
        </Panel>
      </main>
    </SettingTargetProvider>
    </ToastProvider>
  );
}
