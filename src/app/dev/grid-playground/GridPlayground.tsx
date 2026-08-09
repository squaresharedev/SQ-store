"use client";

import { useState } from "react";
import { pageShellClass } from "@/components/ui/surface-styles";
import { secondaryButtonClass } from "@/components/ui/control-styles";
import {
  DEFAULT_STOREFRONT_CONFIG,
  blockKey,
  type ShapeBlock,
  type StorefrontBlock,
} from "@/types/storefront";
import type { GridPlacement } from "@/components/grid/gridConstants";
import { Grid } from "@/components/grid/Grid";
import { BlockTile } from "@/components/storefront/BlockTile";
import { gridGapStyle, scaledCornerRadius } from "@/components/storefront/config-maps";

/**
 * Live editable-grid harness. Renders the same Grid + BlockTile pair the
 * designer canvas uses, but with self-contained state and a fixed 6x6 board,
 * so pointer gestures (drag to move, edge-grab resize, the corner handle)
 * can be exercised and asserted without auth or a storefront. The layout
 * readout below the board mirrors the state as JSON for the browser tests.
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

const INITIAL_BLOCKS: StorefrontBlock[] = [
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

  return (
    <main className={pageShellClass}>
      <h1 className="text-2xl font-semibold text-foreground">
        Grid playground
      </h1>
      <p className="mt-1 max-w-2xl font-inter text-sm text-muted-foreground">
        Drag a tile&apos;s inner surface to move it. Grab any side or corner to
        resize from that edge. Toggle roundness to confirm the controls stay
        visible on circle tiles.
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
          renderBlock={(gridBlock, state) => (
            <BlockTile
              blockKey={gridBlock.key}
              block={gridBlock.data}
              product={null}
              theme={theme}
              editable={state.editable}
              isEditing={selected === gridBlock.key}
              onToggleEdit={(key) =>
                setSelected((current) => (current === key ? null : key))
              }
              onRemove={(key) =>
                setBlocks((current) =>
                  current.filter((b) => blockKey(b) !== key),
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
            blocks.map((b) => [blockKey(b), { x: b.x, y: b.y, w: b.w, h: b.h }]),
          ),
          null,
          2,
        )}
      </pre>
    </main>
  );
}
