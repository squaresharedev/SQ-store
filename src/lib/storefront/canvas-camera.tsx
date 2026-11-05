"use client";

import { createContext, useContext } from "react";

/**
 * Lets something drawn ON the storefront canvas ask the canvas to look at a
 * part of itself: a product page's rating link, jumping to that page's
 * reviews.
 *
 * On the canvas that has to be a CAMERA move. The pages are cards that clip to
 * their own height inside a workspace that clips too, and scrolling either one
 * (which is what `scrollIntoView` does to a clipping box) slides the content
 * under a frame that has no scrollbar to bring it back.
 *
 * The same shape as SettingTargetProvider: the canvas's Stage owns the viewport
 * and provides this; a page deep inside it only reads it.
 *
 * ABSENT PROVIDER IS A SUPPORTED STATE. On the public page, in a dev gallery
 * and in the component tests the hook returns null, and the caller does what
 * an ordinary page does.
 */

export type CanvasCamera = {
  /** Pan the canvas until `target`, an element on it, is at the top of the
   *  open part of the workspace. Eased, unless motion is reduced. */
  jumpTo: (target: Element) => void;
};

const CanvasCameraContext = createContext<CanvasCamera | null>(null);

export const CanvasCameraProvider = CanvasCameraContext.Provider;

/** Null outside a provider — callers must handle that, not assume it. */
export function useCanvasCamera(): CanvasCamera | null {
  return useContext(CanvasCameraContext);
}
