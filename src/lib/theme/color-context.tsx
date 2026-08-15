"use client";

import { createContext, useContext } from "react";
import type { ColorTargetRef } from "./color-target";

/**
 * Lets any color field, wherever it sits, hand itself to the left-hand
 * ColorPanel.
 *
 * WHY CONTEXT. The color fields are scattered across two panels — accent and
 * background in the right-hand ControlsPanel, fill/border/text in the inspector
 * — and neither ControlsPanel nor ThemePanel has any other reason to know the
 * panel exists. Threading a prop through them would make two pass-through
 * components shareholders in a feature they take no part in.
 *
 * Only the OPENER crosses the tree. The panel's data (the resolved target, the
 * storefront's own colors) comes down as ordinary props from StorefrontDesigner,
 * which owns the state anyway.
 *
 * WHY IT LIVES IN lib/. ColorPicker is a components/ui primitive. Importing this
 * from components/storefront would point a shared primitive at a feature folder;
 * from here both sides import downward.
 *
 * ABSENT PROVIDER IS A SUPPORTED STATE. Outside the designer — the dev gallery,
 * component tests — the hook returns null and ColorPicker falls back to its own
 * popover, exactly as it behaved before the panel existed.
 */

export type ColorTargetContextValue = {
  /** What the panel is editing right now, or null when it is closed. */
  activeRef: ColorTargetRef | null;
  /** Point the panel at a field and open it. */
  open: (ref: ColorTargetRef) => void;
  close: () => void;
};

const ColorTargetContext = createContext<ColorTargetContextValue | null>(null);

export const ColorTargetProvider = ColorTargetContext.Provider;

/** Null outside a provider — callers must handle that, not assume it. */
export function useColorTarget(): ColorTargetContextValue | null {
  return useContext(ColorTargetContext);
}

/**
 * True when this ref is the one the panel is showing. Compared field by field
 * rather than by identity: refs are plain data, minted fresh on every render at
 * the call sites, so `===` would never match.
 */
export function isSameColorTarget(
  a: ColorTargetRef | null,
  b: ColorTargetRef | null,
): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  const aKey = "blockKey" in a ? a.blockKey : null;
  const bKey = "blockKey" in b ? b.blockKey : null;
  return aKey === bKey;
}
