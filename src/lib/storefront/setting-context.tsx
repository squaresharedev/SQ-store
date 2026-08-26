"use client";

import { createContext, useContext } from "react";
import type { SettingRef } from "./setting-ref";

/**
 * Lets anything that names a setting (universal search, the panel's own filter
 * field) make the editor open it.
 *
 * The exact shape of ColorTargetProvider, for the exact same reason: the
 * opener has to cross the tree, and nothing else does. StorefrontDesigner owns
 * the state; ControlsPanel, DesignPanel and the inspector READ it and navigate
 * themselves. No component has to be handed a setter it would only pass on.
 *
 * ABSENT PROVIDER IS A SUPPORTED STATE. Outside the designer, and in the
 * component tests, the hook returns null and every reader simply behaves as it
 * did before settings could be opened by name.
 */

export type SettingTargetContextValue = {
  /** The setting the editor is being asked to open, or null. Cleared once the
   *  panel has arrived, so re-renders do not re-navigate. */
  activeRef: SettingRef | null;
  open: (ref: SettingRef) => void;
  close: () => void;
};

const SettingTargetContext = createContext<SettingTargetContextValue | null>(null);

export const SettingTargetProvider = SettingTargetContext.Provider;

/** Null outside a provider — callers must handle that, not assume it. */
export function useSettingTarget(): SettingTargetContextValue | null {
  return useContext(SettingTargetContext);
}
