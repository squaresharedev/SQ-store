"use client";

import { useState } from "react";
import { pageShellClass } from "@/components/ui/surface-styles";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import {
  DEFAULT_STOREFRONT_CONFIG,
  blockKey,
  mergeCardStyleOverrides,
  type CardStyleOverrides,
  type ProductBlock,
  type ShapeBlock,
  type StorefrontBlock,
} from "@/types/storefront";
import type { Product } from "@/types/product";
import type { GridPlacement } from "@/components/grid/gridConstants";
import { Grid } from "@/components/grid/Grid";
import { BlockTile } from "@/components/storefront/BlockTile";
import { gridGapStyle, scaledCornerRadius } from "@/components/storefront/config-maps";

/**
 * Live editable-grid harness. Renders the same Grid + BlockTile pair the
 * designer canvas uses, but with self-contained state and a fixed 6x6 board,
 * so pointer gestures (drag to move, edge-grab resize, the corner handle,
 * and dragging a product's title or price to a new spot) can be exercised and
 * asserted without auth or a storefront. The layout readout below the board
 * mirrors the state as JSON for the browser tests.
 */

const COLUMNS = 6;
const ROWS = 6;

function shape(
  id: string,
  kind: ShapeBlock["kind"],
  color: string,
  placement: GridPlacement,
): StorefrontBlock {
  return { type: "shape", id, kind, color, ...placement };
}

/**
 * The product's photo, inline so the harness needs no network and no R2.
 *
 * DELIBERATELY 2:1 and covered in numbered bands: framing maths only misbehaves
 * where the picture and the frame disagree about their proportions, and a
 * banded picture makes the dimmed copy's alignment with the bright one
 * readable at a glance rather than only in a measurement.
 */
const PHOTO = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">
    <rect width="400" height="200" fill="#1e293b"/>
    ${[0, 1, 2, 3]
      .map(
        (i) =>
          `<rect x="${i * 100}" y="0" width="100" height="200" fill="${
            ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6"][i]
          }"/><text x="${i * 100 + 50}" y="110" font-size="48" fill="#fff" text-anchor="middle" font-family="sans-serif">${i + 1}</text>`,
      )
      .join("")}
    <rect x="2" y="2" width="396" height="196" fill="none" stroke="#fff" stroke-width="4"/>
  </svg>`,
)}`;

/** One real product, so the tile that carries a title and a price is the same
 *  component the designer renders rather than a stand-in. */
const PRODUCT: Product = {
  id: "00000000-0000-4000-9000-000000000001",
  title: "Enamel mug",
  description: "",
  price: 12.5,
  currency: "EUR",
  status: "active",
  imageUrl: PHOTO,
  digitalFileName: null,
  trackStock: false,
  stockQuantity: null,
  lowStockThreshold: 3,
};

const PRODUCT_BLOCK: ProductBlock = {
  type: "product",
  productId: PRODUCT.id,
  x: 3,
  y: 2,
  w: 3,
  h: 3,
};

const INITIAL_BLOCKS: StorefrontBlock[] = [
  PRODUCT_BLOCK,
  shape("00000000-0000-4000-8000-000000000001", "square", "#2563eb", {
    x: 0,
    y: 0,
    w: 2,
    h: 2,
  }),
  shape("00000000-0000-4000-8000-000000000002", "circle", "#16a34a", {
    x: 3,
    y: 0,
    w: 1,
    h: 1,
  }),
  shape("00000000-0000-4000-8000-000000000003", "diamond", "#a855f7", {
    x: 1,
    y: 3,
    w: 2,
    h: 1,
  }),
];

export function GridPlayground() {
  const [blocks, setBlocks] = useState(INITIAL_BLOCKS);
  const [round, setRound] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  /** The tile whose photo is being framed, if any — the harness's stand-in for
   *  the designer's own frame mode, so the crop surface can be driven here. */
  const [framing, setFraming] = useState<string | null>(null);
  /** The designer draws a page node on the sole selection. It is here because
   *  it is CHROME ON THE TILE: it has to be rendered for the board to prove
   *  that selecting a product does not shift the tile's own contents. */
  const [pageOpen, setPageOpen] = useState(false);

  const theme = {
    ...DEFAULT_STOREFRONT_CONFIG.theme,
    cornerRadius: round ? 100 : 0,
    columns: COLUMNS,
    rows: ROWS,
  };

  function patchBlock(key: string, patch: Partial<GridPlacement>) {
    setBlocks((current) =>
      current.map((b) => (blockKey(b) === key ? { ...b, ...patch } : b)),
    );
  }

  /** The same override merge the designer commits a spot drag through. */
  function patchStyle(key: string, patch: CardStyleOverrides) {
    setBlocks((current) =>
      current.map((b) => {
        if (b.type !== "product" || blockKey(b) !== key) return b;
        const style = mergeCardStyleOverrides(b.style, patch);
        if (style === undefined) {
          const rest = { ...b };
          delete rest.style;
          return rest;
        }
        return { ...b, style };
      }),
    );
  }

  return (
    <main className={pageShellClass}>
      <h1 className="text-2xl font-semibold text-foreground">
        Grid playground
      </h1>
      <p className="mt-1 max-w-2xl font-inter text-sm text-muted-foreground">
        Drag a tile&apos;s inner surface to move it. Grab any side or corner to
        resize from that edge. Toggle roundness to confirm the controls stay
        visible on circle tiles. Select the product tile, then drag its title or
        its price to move that label to another spot. Double-click the product
        tile (or press F on it) to frame its photo: the rest of the picture
        shows dimmed around the tile, and it must stay in register with the
        bright part at every zoom.
      </p>

      <button
        type="button"
        onClick={() => setRound((r) => !r)}
        className={secondaryButtonClass + " mt-4"}
      >
        {round ? "Sharp corners" : "Round corners (circle)"}
      </button>

      <div
        className="mt-4 max-w-2xl rounded-md border border-border p-4"
        style={gridGapStyle(theme.gridGap)}
      >
        <Grid
          editable
          showEmptyCells
          blocks={blocks.map((b) => ({
            key: blockKey(b),
            x: b.x,
            y: b.y,
            w: b.w,
            h: b.h,
            rotation: b.rotation,
            data: b,
          }))}
          ariaLabel="Playground grid"
          columns={COLUMNS}
          rows={ROWS}
          cellStyle={(placement) => ({
            borderRadius: scaledCornerRadius(theme.cornerRadius, placement),
          })}
          getBlockLabel={(gridBlock) => `${gridBlock.data.type} ${gridBlock.key}`}
          onMove={(key, x, y) => patchBlock(key, { x, y })}
          onResize={(key, placement) => patchBlock(key, placement)}
          onRotate={(key, rotation) =>
            setBlocks((current) =>
              current.map((b) =>
                blockKey(b) === key ? { ...b, rotation } : b,
              ),
            )
          }
          renderBlock={(gridBlock, state) => (
            <BlockTile
              blockKey={gridBlock.key}
              block={gridBlock.data}
              product={
                gridBlock.data.type === "product" ? PRODUCT : null
              }
              theme={theme}
              editable={state.editable}
              isEditing={selected === gridBlock.key}
              // A spot drag is armed by SOLE selection, so the harness has to
              // say which tile that is or the tokens never appear.
              isSoleSelection={selected === gridBlock.key}
              isFraming={framing === gridBlock.key}
              onToggleEdit={(key) =>
                setSelected((current) => (current === key ? null : key))
              }
              onOpenPage={() => setPageOpen((open) => !open)}
              pageOpen={pageOpen}
              onFrame={(key) => setFraming(key)}
              onFramePlacement={(key, placement) =>
                setBlocks((current) =>
                  current.map((b) =>
                    blockKey(b) === key ? { ...b, imagePlacement: placement } : b,
                  ),
                )
              }
              onFrameExit={() => setFraming(null)}
              onRemove={(key) =>
                setBlocks((current) =>
                  current.filter((b) => blockKey(b) !== key),
                )
              }
              onSpotChange={(key, token, drop) =>
                patchStyle(
                  key,
                  token === "title"
                    ? { titlePosition: drop === "below" ? undefined : drop }
                    : { priceTagPosition: drop },
                )
              }
            />
          )}
        />
      </div>

      {/* Machine-readable state for the browser tests: key -> placement. */}
      <pre
        data-testid="layout"
        className="mt-4 max-w-2xl overflow-x-auto rounded-sm border border-border bg-muted p-3 font-mono text-xs text-foreground"
      >
        {JSON.stringify(
          Object.fromEntries(
            blocks.map((b) => [
              blockKey(b),
              {
                x: b.x,
                y: b.y,
                w: b.w,
                h: b.h,
                // Where a spot drag landed, for the browser tests to read back.
                ...(b.type === "product" && b.style ? { style: b.style } : {}),
                // Likewise for a crop, which is the other thing a gesture on
                // the tile itself writes.
                ...(b.type === "product" && b.imagePlacement
                  ? { imagePlacement: b.imagePlacement }
                  : {}),
                // A tilt, so a spec can prove that resizing a TURNED block
                // still lands it on the board's own lines.
                ...(b.rotation ? { rotation: b.rotation } : {}),
              },
            ]),
          ),
          null,
          2,
        )}
      </pre>
    </main>
  );
}
