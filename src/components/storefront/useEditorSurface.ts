"use client";

import { useSyncExternalStore } from "react";

/**
 * WHICH SURFACE THE EDITOR IS RUNNING ON, as a value rather than a breakpoint.
 *
 * Almost everything about the phone layout is settled in CSS (`lg:` on a class,
 * SHEET_ON_MOBILE_CLASS on a panel) and rightly so. What CSS cannot settle is
 * BEHAVIOUR: whether selecting a block should also open the colour panel, or
 * whether clicking bare canvas should put every panel away. Those are decisions
 * taken in an event handler, where there is no media query to consult, and
 * hard-coding a pixel number in the handler would leave the layout and the
 * behaviour free to disagree about where the phone ends.
 *
 * So this reads the SAME line the classes do. `64rem` is Tailwind's `lg`, and
 * `rem` in a media query is relative to the browser's initial font size rather
 * than the root element's, exactly as it is in the generated stylesheet, so the
 * two cannot drift even if something sets `html { font-size }`.
 *
 * "compact" is the phone/small-tablet layout: panels are bottom sheets sharing
 * one slot over the canvas (see activeMobileSheet). "regular" is `lg` and up,
 * where they are columns beside it.
 *
 * The server has no viewport, so SSR and the hydrating render both get
 * "regular"; the real answer arrives on the first render after hydration. That
 * is safe here because nothing in the MARKUP branches on this. Anything that
 * has to look different on the two surfaces stays a `lg:` class, which the
 * server can render correctly the first time.
 */
const REGULAR_QUERY = "(min-width: 64rem)";

let query: MediaQueryList | null = null;

function mql(): MediaQueryList {
  query ??= window.matchMedia(REGULAR_QUERY);
  return query;
}

function subscribe(onChange: () => void) {
  const list = mql();
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

export type EditorSurface = "compact" | "regular";

function readSurface(): EditorSurface {
  return mql().matches ? "regular" : "compact";
}

export function useEditorSurface(): EditorSurface {
  // getSnapshot returns a primitive and the MediaQueryList is cached, so
  // repeated calls during a render pass are both cheap and identical.
  return useSyncExternalStore(subscribe, readSurface, () => "regular");
}
