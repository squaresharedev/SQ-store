"use client";

import { createContext, useContext } from "react";
// Type-only imports: erased at compile time, zero runtime cost on buyer
// pages. The actual component values are provided only by DesignerCanvas.
import type { InlineTextEditor } from "./InlineTextEditor";
import type { MastheadLineEditor } from "./MastheadLineEditor";
import type { TextRange } from "./InlineTextEditor";

/**
 * Runtime slots for editor components, injected by DesignerCanvas so buyer
 * pages never load InlineTextEditor, MastheadLineEditor, or the
 * text-selection utilities that drive them.
 *
 * Default value: every slot is null, so StorefrontMasthead and
 * TextTileContent render as pure static markup when no provider sits above
 * them (buyer pages, list-card previews, the compact storefront thumbnail).
 */
export type EditorSlots = {
  /** The in-place text editor used by text-block tiles. */
  InlineTextEditor: typeof InlineTextEditor | null;
  /** The in-place editor used by each masthead line. */
  MastheadLineEditor: typeof MastheadLineEditor | null;
  /**
   * Maps a pointer event on a masthead line to the TextRange that editing
   * should open at: a caret where the click landed, or the word under it on
   * a double/triple click. Wraps offsetAtPoint + wordRangeAt from
   * lib/storefront/text-selection; null in the buyer context.
   */
  computeEditRange: ((
    node: HTMLElement | null,
    event: { clientX: number; clientY: number; detail: number } | null,
    text: string,
  ) => TextRange | null) | null;
};

const DEFAULT_SLOTS: EditorSlots = {
  InlineTextEditor: null,
  MastheadLineEditor: null,
  computeEditRange: null,
};

export const EditorSlotsContext = createContext<EditorSlots>(DEFAULT_SLOTS);

/** Read the nearest editor slots, or the buyer-safe defaults when outside any
 *  canvas provider. */
export function useEditorSlots(): EditorSlots {
  return useContext(EditorSlotsContext);
}
