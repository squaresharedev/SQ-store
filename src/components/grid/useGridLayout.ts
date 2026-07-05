import { useCallback, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import {
  SIZE_SPANS,
  type GridBlock,
  type GridSize,
  type GridSpan,
} from "./gridConstants";

// GRID LOGIC hook: owns the layout array and the operations that mutate it
// (add / remove / reorder / resize), keeping `order` canonical. No JSX, no
// rendering, no feature-specific data — generic over the consumer's payload.
//
// The <Grid> component is CONTROLLED (it takes `blocks` + callbacks), so a
// read-only consumer (marketplace) needs none of this. An editable consumer
// (the builder) uses this hook to hold state and feed <Grid>'s callbacks.

/** Reassign `order` to match array index (0..n-1) so it stays canonical. */
function normalizeOrder<TData>(blocks: GridBlock<TData>[]): GridBlock<TData>[] {
  return blocks.map((block, index) =>
    block.order === index ? block : { ...block, order: index },
  );
}

function sortByOrder<TData>(blocks: GridBlock<TData>[]): GridBlock<TData>[] {
  return [...blocks].sort((a, b) => a.order - b.order);
}

export interface UseGridLayoutResult<TData> {
  /** Always sorted by order, with order normalized to 0..n-1. */
  blocks: GridBlock<TData>[];
  /** Replace the whole layout (re-sorted + normalized). */
  setBlocks: (blocks: GridBlock<TData>[]) => void;
  /** Append a block at the end (order assigned automatically). */
  addBlock: (block: Omit<GridBlock<TData>, "order">) => void;
  removeBlock: (key: string) => void;
  /** Move `activeKey` to `overKey`'s slot (from a drag-to-reorder). */
  reorder: (activeKey: string, overKey: string) => void;
  resize: (key: string, size: GridSize) => void;
  /** Size → span mapping, surfaced for convenience. */
  spanFor: (size: GridSize) => GridSpan;
}

export function useGridLayout<TData>(
  initial: GridBlock<TData>[] = [],
): UseGridLayoutResult<TData> {
  const [blocks, setBlocksState] = useState<GridBlock<TData>[]>(() =>
    normalizeOrder(sortByOrder(initial)),
  );

  const setBlocks = useCallback((next: GridBlock<TData>[]) => {
    setBlocksState(normalizeOrder(sortByOrder(next)));
  }, []);

  const addBlock = useCallback((block: Omit<GridBlock<TData>, "order">) => {
    setBlocksState((prev) =>
      normalizeOrder([...prev, { ...block, order: prev.length }]),
    );
  }, []);

  const removeBlock = useCallback((key: string) => {
    setBlocksState((prev) => normalizeOrder(prev.filter((b) => b.key !== key)));
  }, []);

  const reorder = useCallback((activeKey: string, overKey: string) => {
    setBlocksState((prev) => {
      const from = prev.findIndex((b) => b.key === activeKey);
      const to = prev.findIndex((b) => b.key === overKey);
      if (from === -1 || to === -1 || from === to) return prev;
      return normalizeOrder(arrayMove(prev, from, to));
    });
  }, []);

  const resize = useCallback((key: string, size: GridSize) => {
    setBlocksState((prev) =>
      prev.map((b) => (b.key === key && b.size !== size ? { ...b, size } : b)),
    );
  }, []);

  const spanFor = useCallback((size: GridSize) => SIZE_SPANS[size], []);

  return { blocks, setBlocks, addBlock, removeBlock, reorder, resize, spanFor };
}
