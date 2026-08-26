"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { NO_INSETS, safeSpan, type Insets } from "./canvas-geometry";

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

/**
 * Time constant for the follow-through used when a panel re-anchors the board
 * (see useCanvasAnchor). An exponential approach rather than a fixed-length
 * tween, because the target moves under two very different regimes: a panel
 * that pops open jumps hundreds of px once, while a panel edge being DRAGGED
 * re-targets every frame. A spring handles both without a restart, where a
 * tween would keep resetting its own clock and crawl.
 */
const FOLLOW_TAU_MS = 55;
/** Close enough to the target that another frame would not be visible. */
const SETTLED_PX = 0.25;
/** Below this a move is not worth animating; snap and be done. */
const ANIMATE_MIN_PX = 1;

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
 *
 * "On screen" means the part of the workspace no panel is standing on, which is
 * why the insets come into it: a board parked under a bottom sheet is not
 * visible in any sense the seller cares about, and a limit measured against the
 * raw box would happily leave it there.
 */
function clampView(
  view: CanvasView,
  stage: HTMLElement | null,
  insets: Insets,
): CanvasView {
  const frame = stage?.parentElement;
  // The stage is positioned inside the viewport element; before layout its
  // size is 0 and there is nothing meaningful to clamp against.
  if (!stage || !frame || stage.offsetWidth <= 0) return view;

  const boardWidth = stage.offsetWidth * view.zoom;
  const boardHeight = stage.offsetHeight * view.zoom;
  const [minX, maxX] = safeSpan(frame.clientWidth, insets.left, insets.right);
  const [minY, maxY] = safeSpan(frame.clientHeight, insets.top, insets.bottom);
  // Never more than half of what is actually free: a phone with a sheet up
  // leaves a strip barely 200px tall, and demanding 160px of board inside it
  // would overrule the panel-anchor's own answer about where the board should
  // sit, dragging it further than the sheet ever asked for.
  const keepX = Math.min(KEEP_VISIBLE_PX, boardWidth, (maxX - minX) / 2);
  const keepY = Math.min(KEEP_VISIBLE_PX, boardHeight, (maxY - minY) / 2);

  return {
    zoom: view.zoom,
    pan: {
      x: clampNumber(view.pan.x, minX + keepX - boardWidth, maxX - keepX),
      y: clampNumber(view.pan.y, minY + keepY - boardHeight, maxY - keepY),
    },
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

export interface CanvasViewport {
  /** The live view. Always current, never a render behind. */
  get(): CanvasView;
  /**
   * Mutate the view and schedule a paint. The result is clamped so the board
   * can never be pushed out of sight.
   *
   * `animate` eases into the new pan instead of jumping to it, for moves the
   * seller did not make with their own hand (a panel opening under the board).
   * Any plain set, i.e. any real gesture, cancels an animation in flight and
   * takes over from wherever it had got to.
   */
  set(
    next: CanvasView | ((current: CanvasView) => CanvasView),
    options?: { animate?: boolean },
  ): void;
  /** Attach the element that carries the transform. */
  registerStage(node: HTMLElement | null): void;
  /** The stage element, for measuring its natural (untransformed) size. */
  stage(): HTMLElement | null;
  /** How deep floating panels currently cover each workspace edge. */
  insets(): Insets;
  setInsets(next: Insets): void;
  /** Write any pending transform NOW, so a measurement taken this tick
   *  describes the board the seller can actually see. */
  flush(): void;
  subscribe(listener: () => void): () => void;
  getZoom(): number;
}

export function useCanvasViewport(initial: CanvasView): CanvasViewport {
  const viewRef = useRef<CanvasView>(initial);
  const stageRef = useRef<HTMLElement | null>(null);
  const insetsRef = useRef<Insets>(NO_INSETS);
  const frameRef = useRef(0);
  // The animated destination, while one is being eased towards. Null the rest
  // of the time, which is also how "is an animation running" is asked.
  const targetRef = useRef<CanvasView | null>(null);
  const followRef = useRef(0);
  const followStampRef = useRef(0);
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

  const stopFollowing = useCallback(() => {
    if (followRef.current) cancelAnimationFrame(followRef.current);
    followRef.current = 0;
    targetRef.current = null;
  }, []);

  /** Start easing towards `targetRef`, unless a chase is already under way (in
   *  which case it simply picks up the new destination on its next frame). */
  const startFollowing = useCallback(() => {
    if (followRef.current) return;
    followStampRef.current =
      typeof performance !== "undefined" ? performance.now() : 0;
    // A hoisted declaration rather than a const arrow, so the loop can schedule
    // itself without referring to a binding above its own initialiser.
    function step(now: number) {
      followRef.current = 0;
      const target = targetRef.current;
      if (!target) return;
      // Capped: a backgrounded tab hands back a delta of seconds, and an
      // uncapped one would teleport the board on the first frame back.
      const elapsed = Math.min(64, Math.max(0, now - followStampRef.current));
      followStampRef.current = now;
      const closed = 1 - Math.exp(-elapsed / FOLLOW_TAU_MS);
      const { pan } = viewRef.current;
      const x = pan.x + (target.pan.x - pan.x) * closed;
      const y = pan.y + (target.pan.y - pan.y) * closed;
      const settled =
        Math.abs(target.pan.x - x) < SETTLED_PX &&
        Math.abs(target.pan.y - y) < SETTLED_PX;
      viewRef.current = settled ? target : { zoom: target.zoom, pan: { x, y } };
      paint();
      if (settled) targetRef.current = null;
      else followRef.current = requestAnimationFrame(step);
    }
    followRef.current = requestAnimationFrame(step);
  }, [paint]);

  // Created once, never replaced: consumers can hold onto it, and the
  // one-shot event listeners never need re-subscribing. (Lazy state rather
  // than a ref, so nothing reads a ref during render.)
  const [controller] = useState<CanvasViewport>(() => ({
    get: () => viewRef.current,
    getZoom: () => viewRef.current.zoom,
    set(next, options) {
      // Resolved against the LIVE view, never against an animation's pending
      // destination: a gesture that interrupts a re-anchor has to start from
      // the pixels on screen, or the board jumps under the hand.
      const resolved =
        typeof next === "function" ? next(viewRef.current) : next;
      // Clamped HERE, so every route into the viewport — wheel, drag, the
      // zoom buttons, fit, a panel re-anchor — obeys the same limits without
      // repeating them.
      const clamped = clampView(resolved, stageRef.current, insetsRef.current);

      const travel = Math.hypot(
        clamped.pan.x - viewRef.current.pan.x,
        clamped.pan.y - viewRef.current.pan.y,
      );
      if (
        options?.animate &&
        clamped.zoom === viewRef.current.zoom &&
        travel >= ANIMATE_MIN_PX &&
        !prefersReducedMotion()
      ) {
        // Re-targets in place when a chase is already running, so a panel edge
        // being dragged is followed rather than restarted every frame.
        targetRef.current = clamped;
        startFollowing();
        return;
      }

      stopFollowing();
      viewRef.current = clamped;
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
    insets: () => insetsRef.current,
    setInsets(next) {
      insetsRef.current = next;
    },
    flush() {
      if (!frameRef.current) return;
      cancelAnimationFrame(frameRef.current);
      paint();
    },
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
