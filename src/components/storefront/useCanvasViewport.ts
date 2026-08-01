"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

/**
 * THE CANVAS VIEWPORT — pan + zoom, deliberately kept OUT of React state.
 *
 * Wheel and pointer events fire far faster than React commits (a 120Hz
 * trackpad delivers two per frame). Holding the view in component state meant
 * every event read a value that had not been committed yet, so a burst of
 * events all computed from the same stale origin and only the last one
 * survived: measured at 50-97% of the input being thrown away, which is what
 * made diagonal scrolling stutter and fight the cursor.
 *
 * So the live view lives in a REF, mutated synchronously by every event, and
 * the transform is written straight to the stage element inside one
 * requestAnimationFrame per frame. React renders nothing while a gesture
 * runs. Components that need to DISPLAY the zoom subscribe instead
 * (`useZoomValue`), so a readout re-renders without touching the canvas.
 */

export type CanvasView = {
  zoom: number;
  pan: { x: number; y: number };
};

/**
 * How much of the board must stay on screen, in px. The workspace is endless
 * in feel but not in fact: you can push the board almost out of frame, which
 * is useful for working at an edge, but never lose it in blank space with no
 * way back other than the Fit button.
 */
const KEEP_VISIBLE_PX = 160;

function clampNumber(value: number, min: number, max: number): number {
  // min can exceed max for a board smaller than the keep-visible margin; the
  // midpoint is the sane answer there.
  if (min > max) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

/**
 * Hold the pan inside its limits, given the live zoom. The board occupies
 * [pan, pan + size * zoom] in viewport coordinates, so keeping `keep` px of it
 * on screen means pinning the pan between `keep - size` and `viewport - keep`.
 */
function clampView(view: CanvasView, stage: HTMLElement | null): CanvasView {
  const frame = stage?.parentElement;
  // The stage is positioned inside the viewport element; before layout its
  // size is 0 and there is nothing meaningful to clamp against.
  if (!stage || !frame || stage.offsetWidth <= 0) return view;

  const boardWidth = stage.offsetWidth * view.zoom;
  const boardHeight = stage.offsetHeight * view.zoom;
  const keepX = Math.min(KEEP_VISIBLE_PX, boardWidth);
  const keepY = Math.min(KEEP_VISIBLE_PX, boardHeight);

  return {
    zoom: view.zoom,
    pan: {
      x: clampNumber(view.pan.x, keepX - boardWidth, frame.clientWidth - keepX),
      y: clampNumber(view.pan.y, keepY - boardHeight, frame.clientHeight - keepY),
    },
  };
}

export interface CanvasViewport {
  /** The live view. Always current, never a render behind. */
  get(): CanvasView;
  /** Mutate the view and schedule a paint. The result is clamped so the
   *  board can never be pushed out of sight. */
  set(next: CanvasView | ((current: CanvasView) => CanvasView)): void;
  /** Attach the element that carries the transform. */
  registerStage(node: HTMLElement | null): void;
  /** The stage element, for measuring its natural (untransformed) size. */
  stage(): HTMLElement | null;
  subscribe(listener: () => void): () => void;
  getZoom(): number;
}

export function useCanvasViewport(initial: CanvasView): CanvasViewport {
  const viewRef = useRef<CanvasView>(initial);
  const stageRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef(0);
  const listenersRef = useRef(new Set<() => void>());

  const paint = useCallback(() => {
    frameRef.current = 0;
    const stage = stageRef.current;
    if (stage) {
      const { zoom, pan } = viewRef.current;
      // translate3d keeps the stage on its own compositor layer; translate
      // before scale so the pan stays in screen px rather than being
      // multiplied by the zoom.
      stage.style.transform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
    }
    // Subscribers (the zoom readout) are notified at most once a frame.
    for (const listener of listenersRef.current) listener();
  }, []);

  const schedulePaint = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(paint);
  }, [paint]);

  // Created once, never replaced: consumers can hold onto it, and the
  // one-shot event listeners never need re-subscribing. (Lazy state rather
  // than a ref, so nothing reads a ref during render.)
  const [controller] = useState<CanvasViewport>(() => ({
    get: () => viewRef.current,
    getZoom: () => viewRef.current.zoom,
    set(next) {
      // Clamped HERE, so every route into the viewport — wheel, drag, the
      // zoom buttons, fit — obeys the same limits without repeating them.
      viewRef.current = clampView(
        typeof next === "function" ? next(viewRef.current) : next,
        stageRef.current,
      );
      schedulePaint();
    },
    registerStage(node) {
      stageRef.current = node;
      // Paint immediately so a freshly mounted stage is not left at the
      // origin for a frame.
      if (node) {
        const { zoom, pan } = viewRef.current;
        node.style.transform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
      }
    },
    stage: () => stageRef.current,
    subscribe(listener) {
      listenersRef.current.add(listener);
      return () => {
        listenersRef.current.delete(listener);
      };
    },
  }));
  return controller;
}

/** Subscribe a small component to the zoom, so it can show the percentage
 *  without re-rendering the canvas. */
export function useZoomValue(viewport: CanvasViewport): number {
  return useSyncExternalStore(
    viewport.subscribe,
    viewport.getZoom,
    viewport.getZoom,
  );
}
