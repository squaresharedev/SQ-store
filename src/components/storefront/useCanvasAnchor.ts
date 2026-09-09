"use client";

import { useCallback, useRef } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";
import {
  NO_INSETS,
  boxesEqual,
  insetsEqual,
  mergeInsets,
  panelInset,
  reanchorPan,
  revealPan,
  type Box,
  type Insets,
} from "./canvas-geometry";
import type { CanvasViewport } from "./useCanvasViewport";

/**
 * KEEPING THE BOARD STILL WHILE THE PANELS MOVE.
 *
 * This hook is the DOM half of canvas-geometry: it watches the workspace box
 * and every panel that could cover it, and hands the pair of rules in that file
 * whatever they need to answer "should the board move, and by how much".
 *
 * It is deliberately measurement-driven rather than told about panels. Nothing
 * here knows that the colour column is 17.5rem, that the design column is
 * draggable, or that a phone turns all of them into bottom sheets. A panel
 * simply marks itself with `data-canvas-panel` and gets measured, so a new
 * panel, on a new edge, at a new size, is covered the day it is written.
 *
 * WHAT COUNTS AS A CHANGE. The workspace's own box, the panel cover over it,
 * and which blocks are selected. Typing and saving move nothing, because they
 * change none of the three.
 *
 * The first two are the panel rules in canvas-geometry, and they read the
 * selection only as the thing worth keeping in view while a panel moves. The
 * third is a separate, quieter rule (revealPan) that exists because the cover
 * can stay exactly the same size while what is under it changes — inserting
 * from a sheet, or swapping one full-width sheet for another of the same
 * height — and in those moments the seller has just said which block they mean.
 * It slides by the least that puts that block in the open, and by nothing at
 * all when it is already there, which is every selection on a desktop.
 */

/**
 * Marks a surface that can cover the canvas. Goes on the element that is
 * actually painted (the sheet, not the column that holds it), because on
 * desktop that element is laid out beside the canvas and costs it nothing,
 * while on a phone the very same element is a fixed sheet lying over it. One
 * attribute, both stories, no breakpoint in the JavaScript.
 */
export const CANVAS_PANEL_ATTR = "data-canvas-panel";
const PANEL_SELECTOR = `[${CANVAS_PANEL_ATTR}]`;

function toBox(rect: DOMRect): Box {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/** Every panel currently in the document, painted or not. Hidden ones measure
 *  zero and drop out downstream. */
function panelElements(): HTMLElement[] {
  const found: HTMLElement[] = [];
  document
    .querySelectorAll<HTMLElement>(PANEL_SELECTOR)
    .forEach((node) => found.push(node));
  return found;
}

/** Same blocks, in the same order. Order counts because the array comes
 *  straight from the designer's own selection state, which keeps it stable. */
function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

function coverOf(workspace: Box, panels: HTMLElement[]): Insets {
  let insets = NO_INSETS;
  for (const panel of panels) {
    const rect = panel.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    insets = mergeInsets(insets, panelInset(workspace, toBox(rect)));
  }
  return insets;
}

/** The board's full extent, in its own UNSCALED coordinates. */
function boardBox(stage: HTMLElement): Box {
  return {
    left: 0,
    top: 0,
    width: stage.offsetWidth,
    height: stage.offsetHeight,
  };
}

/**
 * The selected tiles, in the board's own UNSCALED coordinates, falling back to
 * the whole board when there is no selection to speak of.
 *
 * This is the fallback anchor, used on whichever axis the board itself no
 * longer fits (see keepVisible): a seller who opened a panel from a block is
 * asking about that block, and on a phone, where a sheet can take most of the
 * screen, revealing the whole board is impossible while revealing the one tile
 * usually is not.
 *
 * TWO BOXES, NOT ONE. `withChrome` is the tile PLUS the controls that hang
 * outside it — the chip welded above its top edge, the resize and rotate
 * handles welded under its bottom edge (see TILE_CONTROL_CHIP_CLASS and
 * HANDLE_CLASS). Anchoring on the bare cell revealed the tile flush against
 * the sheet's top edge and left both bottom handles buried underneath it, on
 * the one form factor where they are always drawn and are the only route to
 * resizing or rotating a block. `cell` stays as the fallback for a strip too
 * short to hold both the tile and its chrome, where insisting on the padded
 * box would fit nothing and move the board not at all.
 *
 * Read off the live DOM rather than from block coordinates so a tilted tile
 * counts by the room it actually takes, and so a masthead (which has no grid
 * cell of its own) simply falls back to the board.
 */
function selectionBoxes(
  stage: HTMLElement,
  keys: readonly string[],
): { cell: Box; withChrome: Box } {
  const board = boardBox(stage);
  const both = { cell: board, withChrome: board };
  if (keys.length === 0) return both;

  const stageRect = stage.getBoundingClientRect();
  // The stage is scaled, so its client rect is post-transform. Dividing by the
  // measured scale gets back to board coordinates, and the OFFSET being
  // relative to the stage means the answer does not depend on the pan (which
  // is exactly what is about to change).
  const scale = stage.offsetWidth > 0 ? stageRect.width / stage.offsetWidth : 1;
  if (!(scale > 0)) return both;

  const wanted = new Set(keys);
  const bare = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const padded = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  const swallow = (
    into: typeof bare,
    rect: { left: number; top: number; right: number; bottom: number },
  ) => {
    into.left = Math.min(into.left, (rect.left - stageRect.left) / scale);
    into.top = Math.min(into.top, (rect.top - stageRect.top) / scale);
    into.right = Math.max(into.right, (rect.right - stageRect.left) / scale);
    into.bottom = Math.max(into.bottom, (rect.bottom - stageRect.top) / scale);
  };

  stage.querySelectorAll<HTMLElement>("[data-grid-key]").forEach((cell) => {
    if (!wanted.has(cell.dataset.gridKey ?? "")) return;
    const rect = cell.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    swallow(bare, rect);
    swallow(padded, rect);
    // Chrome that is drawn but takes no room in the cell's own box: the cell
    // is `contain: layout`, so anything hanging outside it is invisible to
    // that rect and has to be measured for itself. A control the block has
    // hidden (a handle behind a framing overlay) measures zero and drops out.
    cell.querySelectorAll<HTMLElement>("[data-tile-chrome]").forEach((control) => {
      const box = control.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      swallow(padded, box);
    });
  });
  if (!Number.isFinite(bare.left)) return both;
  const toBoxOf = (edges: typeof bare): Box => ({
    left: edges.left,
    top: edges.top,
    width: edges.right - edges.left,
    height: edges.bottom - edges.top,
  });
  return { cell: toBoxOf(bare), withChrome: toBoxOf(padded) };
}

export function useCanvasAnchor({
  viewport,
  workspaceRef,
  enabled,
  anchorKeys,
}: {
  viewport: CanvasViewport;
  /** The window the board floats behind. */
  workspaceRef: React.RefObject<HTMLElement | null>;
  /** Design view only. The mobile preview is a plain scrolling column with no
   *  pan of its own, so there is nothing to hold still. */
  enabled: boolean;
  /** Keys of the blocks the seller is working on, kept in view ahead of the
   *  board as a whole. */
  anchorKeys: readonly string[];
}): void {
  const lastBox = useRef<Box | null>(null);
  const lastInsets = useRef<Insets>(NO_INSETS);
  /** The selection as it was last measured, so a change in it can be told
   *  apart from the many renders that leave it alone. */
  const lastKeys = useRef<readonly string[]>([]);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedRef = useRef(new Set<Element>());

  // Live props for `sync`, which is identity-stable so the ResizeObserver and
  // the per-render effect below never churn.
  const latest = useRef({ enabled, anchorKeys });
  useIsomorphicLayoutEffect(() => {
    latest.current = { enabled, anchorKeys };
  });

  /** Observe exactly `nodes`, no more and no less. */
  const watch = useCallback((nodes: Element[]) => {
    const observer = observerRef.current;
    if (!observer) return;
    const wanted = new Set(nodes);
    observedRef.current.forEach((node) => {
      if (wanted.has(node)) return;
      observer.unobserve(node);
      observedRef.current.delete(node);
    });
    wanted.forEach((node) => {
      if (observedRef.current.has(node)) return;
      observer.observe(node);
      observedRef.current.add(node);
    });
  }, []);

  const sync = useCallback(() => {
    const area = workspaceRef.current;
    if (!area) return;
    const { enabled: on, anchorKeys: keys } = latest.current;
    if (!on) {
      // Left design view. Forget the box, so coming back measures afresh
      // instead of holding the board against a workspace that stopped
      // existing several layouts ago.
      lastBox.current = null;
      lastInsets.current = NO_INSETS;
      lastKeys.current = keys;
      viewport.setInsets(NO_INSETS);
      return;
    }
    // Any pan scheduled for the next frame is written NOW: every rect read
    // below has to describe the board as it is on screen this tick.
    viewport.flush();

    const rect = area.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const box = toBox(rect);
    const panels = panelElements();
    // A sheet can grow without any render of ours (a section expanding inside
    // it), and a taller sheet covers more board.
    watch([area, ...panels]);
    const insets = coverOf(box, panels);

    const previousBox = lastBox.current;
    const previousInsets = lastInsets.current;
    const previousKeys = lastKeys.current;
    lastBox.current = box;
    lastInsets.current = insets;
    lastKeys.current = keys;

    const stage = viewport.stage();
    const changed =
      previousBox !== null &&
      !(boxesEqual(previousBox, box) && insetsEqual(previousInsets, insets));
    // Nothing to answer for: the first measurement (no "before" to hold the
    // board against), an unchanged layout, or a board that has not laid out.
    if (!changed || !stage || stage.offsetWidth <= 0) {
      viewport.setInsets(insets);
      // The layout held still, but the SELECTION may not have. A block chosen
      // while a sheet is already up — inserted from the library, picked out of
      // the layers list — can be sitting straight under it, and no panel rule
      // will ever fire for it because no panel moved. Nothing to reveal when
      // the selection was merely CLEARED: there is no block being asked about
      // then, and sliding the bare board around would undo a board the seller
      // parked where they wanted it.
      const laidOut = stage !== null && stage.offsetWidth > 0;
      if (laidOut && keys.length > 0 && !sameKeys(previousKeys, keys)) {
        const view = viewport.get();
        const anchors = selectionBoxes(stage, keys);
        viewport.set(
          () => ({
            zoom: view.zoom,
            pan: revealPan({
              pan: view.pan,
              zoom: view.zoom,
              workspace: box,
              insets,
              anchor: anchors.withChrome,
              anchorFallback: anchors.cell,
            }),
          }),
          { animate: true },
        );
      }
      return;
    }

    const view = viewport.get();
    const anchors = selectionBoxes(stage, keys);
    const { hold, pan } = reanchorPan({
      pan: view.pan,
      zoom: view.zoom,
      previous: previousBox,
      previousInsets,
      workspace: box,
      insets,
      board: boardBox(stage),
      anchor: anchors.withChrome,
      anchorFallback: anchors.cell,
    });

    // THE TWO RULES, AT THEIR TWO SPEEDS.
    //
    // Holding still is a CORRECTION, and it lands in the same frame the layout
    // changed: the board is already meant to be on those pixels, so easing
    // into the position would draw the very slide the correction exists to
    // prevent. Written while the OLD cover is still in force, or the
    // keep-visible clamp would read the new panel and do half the recovery
    // here, instantly, on its own. (A floating panel moves no corner, so this
    // is a no-op for it, which is the whole reason the colour layer floats.)
    viewport.set(() => ({ zoom: view.zoom, pan: hold }));

    // Getting out from under a panel is a real MOVE, so it eases. Absolute,
    // not a delta: the clamp below now knows about the new cover, and it has
    // to be applied to the destination exactly once.
    viewport.setInsets(insets);
    viewport.set(() => ({ zoom: view.zoom, pan }), { animate: true });
  }, [viewport, workspaceRef, watch]);

  // One observer for the hook's whole life; `watch` keeps its subject list
  // current. Declared before the per-render effect so the very first `sync`
  // already has something to register with.
  useIsomorphicLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => sync());
    observerRef.current = observer;
    return () => {
      observer.disconnect();
      observerRef.current = null;
      observedRef.current.clear();
    };
  }, [sync]);

  // Every render, because a panel opening IS a render and its effect on the
  // layout is already in the DOM by the time this runs. Cheap: one rect per
  // panel, and an unchanged layout leaves after the comparison above.
  useIsomorphicLayoutEffect(() => {
    sync();
  });
}
