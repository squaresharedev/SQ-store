"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import type { GridInset, GridPlacement } from "@/components/grid/gridConstants";
import {
  linkedBandIds,
  newBand,
  newBandRows,
  placeBand,
  replaceBand,
} from "@/lib/storefront/bands";
import { defaultButtonLink, newButtonBlock, withButtonPatch, withFine, withoutDeadLinks } from "@/lib/storefront/layout-blocks";
import type { Product } from "@/types/product";
import { linkChoicesFor, type LayoutEditorValue } from "./layout-editor-context";
import type { LinkableStorefront } from "./LinkDestinationField";
import {
  blockKey,
  type BandBackground,
  type BlockPlacement,
  type ButtonBlock,
  type StorefrontBand,
  type StorefrontBlock,
  type StorefrontHeader,
  type StorefrontTheme,
} from "@/types/storefront";

/**
 * THE DESIGNER'S LAYOUT AND NAVIGATION EDITS, out of StorefrontDesigner: the
 * bands (add, select, move by rows, repaint, remove), half-cell placement of
 * a block (the grid's onPlace), and adding a button.
 *
 * The designer owns the undoable state (its snapshot holds `bands` beside
 * `blocks`) and hands it in each render with the few of its own functions
 * this needs; everything returned keeps its identity across renders, so the
 * memoised canvas is not invalidated by it.
 *
 * A BAND IS SELECTED APART FROM BLOCKS. It is not a block (types/storefront,
 * FULL-WIDTH BANDS), so it never joins the block selection: selecting one
 * clears the blocks, and selecting a block clears it.
 */
export type LayoutEditingDeps = {
  theme: StorefrontTheme;
  blocks: StorefrontBlock[];
  header: StorefrontHeader;
  bands: StorefrontBand[];
  setBands: Dispatch<SetStateAction<StorefrontBand[]>>;
  setBlocks: Dispatch<SetStateAction<StorefrontBlock[]>>;
  /** Every undoable mutation calls this first (StorefrontDesigner's). */
  recordChange: (coalesceKey?: string) => void;
  /** Whether any block is selected right now. */
  blocksSelected: boolean;
  /** Clears the block selection (a band was selected). */
  clearBlockSelection: () => void;
  /** Puts a new block on the board where there is room (the designer's own
   *  insertBlock, honouring a clicked free cell). Null at the block cap. */
  insertBlock: (build: (placement: BlockPlacement) => StorefrontBlock, w: number, h: number) => StorefrontBlock | null;
  /** Selects a block the designer just inserted. */
  selectInserted: (block: StorefrontBlock) => void;
  /** Says there is no row left for a new band. */
  onNoRoomForBand: () => void;
  /** The words a new button starts with, in the seller's language. */
  newButtonLabel: string;
  /** This storefront, which a new button leads to when the board has nothing
   *  else to point it at. */
  storefrontId: string;
  /** The catalogue, for naming the products a link may lead to. */
  productsById: ReadonlyMap<string, Product>;
  /** The store's storefronts a link may lead to. Absent = this one alone,
   *  under its own name. */
  storefronts?: readonly LinkableStorefront[];
  storefrontName: string;
  /** Display URLs by object key, and the way to add one (an upload). */
  photoUrls: Readonly<Record<string, string>>;
  onPhotoUrl: (key: string, url: string) => void;
};

export function useLayoutEditing(deps: LayoutEditingDeps) {
  const t = useTranslations("EditorLayout.panel");
  const live = useRef(deps);
  useEffect(() => {
    live.current = deps;
  });

  const [selectedBandId, setSelectedBandId] = useState<string | null>(null);
  // Selecting a block takes the band selection away (adjusted while
  // rendering, the way React asks for state that follows other state).
  const [blocksWereSelected, setBlocksWereSelected] = useState(deps.blocksSelected);
  if (deps.blocksSelected !== blocksWereSelected) {
    setBlocksWereSelected(deps.blocksSelected);
    if (deps.blocksSelected && selectedBandId !== null) setSelectedBandId(null);
  }
  const selectedBand = deps.bands.find((band) => band.id === selectedBandId) ?? null;

  const selectBand = useCallback((id: string | null) => {
    setSelectedBandId(id);
    if (id !== null) live.current.clearBlockSelection();
  }, []);

  const addBand = useCallback(() => {
    const { bands, theme, setBands, recordChange, onNoRoomForBand } = live.current;
    const rowsAt = newBandRows(bands, theme.rows);
    if (!rowsAt) {
      onNoRoomForBand();
      return;
    }
    const band = newBand(crypto.randomUUID(), rowsAt, theme);
    recordChange();
    setBands((current) => [...current, band]);
    setSelectedBandId(band.id);
    live.current.clearBlockSelection();
  }, []);

  /** A band dragged by its rows, or stretched: one undo step per drag. */
  const moveBand = useCallback((id: string, at: { y: number; h: number }) => {
    const { bands, theme, setBands, recordChange } = live.current;
    const band = bands.find((candidate) => candidate.id === id);
    if (!band) return;
    const next = placeBand(band, at, theme.rows);
    if (next === band) return;
    recordChange(`band:${id}`);
    setBands((current) => replaceBand(current, next));
  }, []);

  const paintBand = useCallback((id: string, background: BandBackground) => {
    const { setBands, recordChange } = live.current;
    recordChange(`band-paint:${id}`);
    setBands((current) => current.map((band) => (band.id === id ? { ...band, background } : band)));
  }, []);

  /** Taken away, unless a link leads to it (the panel says so first). */
  const removeBand = useCallback((id: string) => {
    const { blocks, header, setBands, recordChange } = live.current;
    if (linkedBandIds(blocks, header.links).has(id)) return;
    recordChange();
    setBands((current) => current.filter((band) => band.id !== id));
    setSelectedBandId(null);
  }, []);

  /** Where the grid's half-step gestures land: whole cells plus insets. */
  const placeBlock = useCallback((key: string, placement: GridPlacement, inset: GridInset | undefined) => {
    const { setBlocks, recordChange } = live.current;
    recordChange(`move:${key}`);
    setBlocks((current) => current.map((block) => (blockKey(block) === key ? withFine({ ...block, ...placement }, inset) : block)));
  }, []);

  /** A new button, two cells wide and half a cell tall, leading nowhere until
   *  the seller says where: it starts on the first product or band there is,
   *  or a web address to fill in. */
  const addButton = useCallback(() => {
    const { insertBlock, selectInserted, blocks, bands, newButtonLabel, storefrontId } = live.current;
    const link = defaultButtonLink(blocks, bands, storefrontId);
    const block = insertBlock((placement) => newButtonBlock(crypto.randomUUID(), placement, newButtonLabel, link), 2, 1);
    if (block) selectInserted(block);
  }, []);

  /** A button's words, destination or look; typing its words is one undo step. */
  const updateButton = useCallback((key: string, patch: Partial<Pick<ButtonBlock, "label" | "link" | "look">>) => {
    const { setBlocks, recordChange } = live.current;
    recordChange(`button:${key}:${Object.keys(patch).join(",")}`);
    setBlocks((current) =>
      current.map((block) => (block.type === "button" && blockKey(block) === key ? withButtonPatch(block, patch) : block)),
    );
  }, []);

  /** The inspector's title and close label for a band or a button, or null
   *  for anything else (the designer's own titles answer). */
  const inspectorTitle = (selected: StorefrontBlock | null): { title: string; close: string } | null =>
    selectedBand
      ? { title: t("band.title"), close: t("band.close") }
      : selected?.type === "button"
        ? { title: t("button.title"), close: t("button.close") }
        : null;

  // What the layout panels read through LayoutEditorProvider.
  const { blocks, bands, productsById, photoUrls, storefrontId, storefrontName } = deps;
  const storefronts = useMemo(
    () => deps.storefronts ?? [{ id: storefrontId, name: storefrontName }],
    [deps.storefronts, storefrontId, storefrontName],
  );
  const onPhotoUrl = useCallback((key: string, url: string) => live.current.onPhotoUrl(key, url), []);
  const editor = useMemo<LayoutEditorValue>(
    () => ({ ...linkChoicesFor(blocks, bands, productsById, storefronts), photoUrls, onPhotoUrl }),
    [blocks, bands, productsById, storefronts, photoUrls, onPhotoUrl],
  );

  return {
    selectedBand,
    editor,
    inspectorTitle,
    updateButton,
    selectBand,
    addBand,
    moveBand,
    paintBand,
    removeBand,
    placeBlock,
    addButton,
    /** The board with every link to something gone dropped (StorefrontDesigner's
     *  removal hook). */
    withoutDeadLinks,
  };
}
