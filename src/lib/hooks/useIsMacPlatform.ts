"use client";

import { useSyncExternalStore } from "react";

/**
 * Which modifier key label to show for a keyboard shortcut: ⌘ on a Mac,
 * Ctrl elsewhere. A browser fact, not React state, so it is read through
 * `useSyncExternalStore` rather than a `useState` + `useEffect` pair — the
 * server snapshot is `null` (unknown), the client snapshot is the real
 * answer, and nothing here ever calls `setState` from inside an effect.
 * That keeps hydration honest: showing the wrong modifier for a frame would
 * be worse than showing none.
 *
 * Shared by every surface that renders the ⌘K / Ctrl K hint (the trigger and
 * the expanded bar it becomes), so the two can never drift out of sync.
 */
const NEVER_CHANGES = () => () => {};
const readIsMac = () => /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
const UNKNOWN_ON_SERVER = () => null;

export function useIsMacPlatform(): boolean | null {
  return useSyncExternalStore(NEVER_CHANGES, readIsMac, UNKNOWN_ON_SERVER);
}
