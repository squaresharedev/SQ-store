"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the primary pointing device is coarse (touch), not fine (mouse).
 * Used to show tap-friendly copy in drop zones instead of drag-and-drop language.
 *
 * Uses the same useSyncExternalStore pattern as useIsMacPlatform: the server
 * snapshot is `null` (unknown), the client snapshot is the real answer, and
 * the subscription never fires because the pointer type does not change at
 * runtime.
 */
const NEVER_CHANGES = () => () => {};
// Optional, like the other matchMedia readers: jsdom (the component tests) has none.
const readIsTouch = () => window.matchMedia?.("(pointer: coarse)").matches ?? false;
const UNKNOWN_ON_SERVER = () => null;

export function useIsTouch(): boolean | null {
  return useSyncExternalStore(NEVER_CHANGES, readIsTouch, UNKNOWN_ON_SERVER);
}
