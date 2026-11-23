"use client";

import { useState } from "react";
import { DesignerCanvas } from "@/components/storefront/DesignerCanvas";
import { LayoutInspector } from "@/components/storefront/LayoutInspector";
import { HeaderSection } from "@/components/storefront/HeaderSection";
import { LayoutEditorProvider } from "@/components/storefront/layout-editor-context";
import { useLayoutEditing } from "@/components/storefront/useLayoutEditing";
import { findFreeCell } from "@/components/grid/gridConstants";
import { pinOnPhone } from "@/lib/storefront/mobile-layout";
import type { Product } from "@/types/product";
import {
  blockKey,
  withRotation,
  type StorefrontBand,
  type StorefrontBlock,
  type StorefrontConfig,
  type StorefrontHeader,
} from "@/types/storefront";
import { GALLERY_BAND_PHOTO, GALLERY_LOGO } from "./fixtures";

/**
 * The designer's canvas with the layout workstream's pieces live on it: the
 * band rails (press one to edit the band, drag it to move it), half-step
 * dragging of the small blocks, a button's or a carousel's panel when one is
 * selected, and the library's band, button and carousel. State is local;
 * nothing is saved.
 */
export function DesignerLab({
  config,
  products,
  device,
}: {
  config: StorefrontConfig;
  products: readonly Product[];
  device: "desktop" | "mobile";
}) {
  const [blocks, setBlocks] = useState<StorefrontBlock[]>(config.blocks);
  const [bands, setBands] = useState<StorefrontBand[]>(config.bands ?? []);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [previewMode, setPreviewMode] = useState(device);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [
        ...(config.bands ?? []).flatMap((band) => (band.background.kind === "image" ? [[band.background.key, GALLERY_BAND_PHOTO]] : [])),
        ...(config.header?.logo ? [[config.header.logo.key, GALLERY_LOGO]] : []),
      ],
    ),
  );
  const [header, setHeader] = useState<StorefrontHeader>(config.header ?? { show: false, name: "", bio: "" });
  const theme = config.theme;
  const [productsById] = useState(() => new Map(products.map((product) => [product.id, product])));

  const layout = useLayoutEditing({
    theme,
    blocks,
    header,
    bands,
    setBands,
    setBlocks,
    recordChange: () => {},
    storefrontId: "sample",
    storefrontName: "Parallel Goods",
    productsById,
    photoUrls,
    onPhotoUrl: (key, url) => setPhotoUrls((current) => ({ ...current, [key]: url })),
    blocksSelected: selectedKeys.length > 0,
    clearBlockSelection: () => setSelectedKeys([]),
    insertBlock: (build, w, h) => {
      const grid = blocks.map((block) => ({ ...block, key: blockKey(block), data: null }));
      const spot = findFreeCell(grid, w, h, theme.columns, theme.rows);
      if (!spot) return null;
      const block = build({ x: spot.x, y: spot.y, w, h });
      setBlocks((current) => [...current, block]);
      return block;
    },
    selectInserted: (block) => setSelectedKeys([blockKey(block)]),
    onNoRoomForBand: () => {},
    onNoProductsForCarousel: () => {},
    newButtonLabel: "Shop now",
  });

  const move = (moves: readonly { key: string; x: number; y: number }[]) => {
    const at = new Map(moves.map((entry) => [entry.key, entry]));
    setBlocks((current) =>
      current.map((block) => {
        const landing = at.get(blockKey(block));
        return landing ? { ...block, x: landing.x, y: landing.y } : block;
      }),
    );
  };
  const selectedBlock = selectedKeys.length === 1 ? (blocks.find((block) => blockKey(block) === selectedKeys[0]) ?? null) : null;

  return (
    <div className="flex min-h-screen gap-4 bg-muted/40 p-4" data-designer-lab="">
      <div className="relative min-h-[1600px] flex-1 overflow-auto">
        <DesignerCanvas
          blocks={blocks}
          productsById={productsById}
          theme={theme}
          header={header}
          previewMode={previewMode}
          onPreviewModeChange={setPreviewMode}
          pagePhotoUrls={photoUrls}
          onMoveBlock={(key, x, y) => move([{ key, x, y }])}
          onMoveBlocks={move}
          onResizeBlock={(key, placement) =>
            setBlocks((current) => current.map((block) => (blockKey(block) === key ? { ...block, ...placement } : block)))
          }
          onMoveOnPhone={(moves) =>
            setBlocks((current) => pinOnPhone(theme, current, new Map(moves.map(({ key, x, y }) => [key, { x, y }]))))
          }
          onResizeOnPhone={(key, { x, y, w, h }) =>
            setBlocks((current) => pinOnPhone(theme, current, new Map([[key, { x, y, w, h }]])))
          }
          onRotateBlock={(key, rotation) =>
            setBlocks((current) => current.map((block) => (blockKey(block) === key ? withRotation(block, rotation) : block)))
          }
          onEmptyCellClick={() => {}}
          selectedKeys={selectedKeys}
          onSelectBlock={(key, additive) => {
            if (key === null) return setSelectedKeys([]);
            setSelectedKeys((current) => (additive ? [...current, key] : current.length === 1 && current[0] === key ? [] : [key]));
          }}
          onSelectMany={setSelectedKeys}
          bands={bands}
          selectedBandId={layout.selectedBand?.id ?? null}
          onSelectBand={layout.selectBand}
          onMoveBand={layout.moveBand}
          onPlaceBlock={layout.placeBlock}
        />
      </div>
      <aside className="w-80 shrink-0 space-y-4 border border-border bg-background p-4" data-lab-inspector="">
        <div className="flex gap-2">
          <button type="button" className="border border-border px-2 py-1 text-xs" onClick={layout.addBand} data-lab-add-band="">
            + band
          </button>
          <button type="button" className="border border-border px-2 py-1 text-xs" onClick={layout.addButton} data-lab-add-button="">
            + button
          </button>
          <button type="button" className="border border-border px-2 py-1 text-xs" onClick={layout.addCarousel} data-lab-add-carousel="">
            + carousel
          </button>
        </div>
        <LayoutInspector
          layout={layout}
          button={selectedBlock?.type === "button" ? selectedBlock : null}
          carousel={selectedBlock?.type === "carousel" ? selectedBlock : null}
          theme={theme}
          blocks={blocks}
          header={header}
          onDuplicate={() => {}}
          onRemove={(key) => setBlocks((current) => layout.withoutDeadLinks(current.filter((block) => blockKey(block) !== key), bands))}
        />
        <LayoutEditorProvider value={layout.editor}>
          <HeaderSection header={header} onChange={setHeader} />
        </LayoutEditorProvider>
        <pre className="overflow-auto text-2xs" data-lab-state="">
          {JSON.stringify({ bands: bands.map(({ id, y, h }) => ({ id: id.slice(-2), y, h })), fine: blocks.flatMap((block) => ("fine" in block && block.fine ? [{ key: blockKey(block).slice(-2), x: block.x, y: block.y, w: block.w, h: block.h, fine: block.fine }] : [])), header: { logo: header.logo, links: header.links }, buttons: blocks.flatMap((block) => (block.type === "button" ? [{ key: blockKey(block).slice(-2), label: block.label, link: block.link, look: block.look }] : [])) }, null, 1)}
        </pre>
      </aside>
    </div>
  );
}
