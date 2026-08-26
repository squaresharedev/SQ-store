"use client";

import { useEffect, useLayoutEffect } from "react";
import { SYSTEM_DARK_QUERY, THEME_STORAGE_KEY } from "@/lib/theme-mode";

/**
 * Layout effect on the client so the palette settles BEFORE paint; a plain
 * effect on the server, where layout effects warn.
 */
const useThemeEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Makes sure the resolved theme is actually on <html> by the time an error
 * screen paints.
 *
 * The pre-paint script in the root layout normally does this, and on any
 * streamed page it already has. But an error boundary is not a streamed page:
 * when a render throws, React rebuilds the shell on the CLIENT, and that
 * rebuild drops the attribute the script had written. Without this, a 500 on a
 * dark-mode machine came out white.
 *
 * Deliberately has no dependency array. It is a cheap string comparison that
 * short-circuits when the attribute is already right, and running it on every
 * render is what makes it a genuine backstop rather than a one-shot that a
 * later re-render can undo.
 */
export function ThemeSync() {
  useThemeEffect(() => {
    const root = document.documentElement;
    if (root.dataset.theme === "light" || root.dataset.theme === "dark") return;

    let saved: string | null = null;
    try {
      saved = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Private mode, blocked storage: fall through to the OS.
    }
    root.dataset.theme =
      saved === "light" || saved === "dark"
        ? saved
        : window.matchMedia(SYSTEM_DARK_QUERY).matches
          ? "dark"
          : "light";
  });

  return null;
}
