"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

type Listener = () => void;

/**
 * What every text block's Auto sizing is CURRENTLY rendering at on the
 * canvas, published by TextTileContent and read by the inspector's
 * FontSizeField — so "Auto (NN px)", and the slider's own starting point,
 * describe a block that has shrunk to fit its box rather than the flat number
 * its style would render at in an infinite one.
 *
 * A tiny pub-sub rather than lifted state: the publisher (deep in the canvas)
 * and the reader (the side panel) are cousins, not ancestor and descendant —
 * see StorefrontDesigner, which renders both from the same block list but
 * neither from the other. Threading the live size through as a prop would
 * make every component between them a shareholder in a feature they take no
 * part in, the same reasoning ColorTargetProvider already applies one field
 * over (see lib/theme/color-context).
 *
 * ABSENT PROVIDER IS A SUPPORTED STATE: the dev gallery and component tests
 * render either side alone, and `useReportedAutoFitSize` answers `undefined`
 * rather than throwing, so a caller's own fallback (the style's base size)
 * takes over exactly as it did before this existed.
 */
export type AutoFitRegistry = {
  report: (key: string, px: number) => void;
  clear: (key: string) => void;
  get: (key: string) => number | undefined;
  subscribe: (key: string, listener: Listener) => () => void;
};

export function createAutoFitRegistry(): AutoFitRegistry {
  const sizes = new Map<string, number>();
  const listeners = new Map<string, Set<Listener>>();

  function notify(key: string) {
    for (const listener of listeners.get(key) ?? []) listener();
  }

  return {
    report(key, px) {
      if (sizes.get(key) === px) return;
      sizes.set(key, px);
      notify(key);
    },
    clear(key) {
      if (!sizes.has(key)) return;
      sizes.delete(key);
      notify(key);
    },
    get: (key) => sizes.get(key),
    subscribe(key, listener) {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(key);
      };
    },
  };
}

const AutoFitRegistryContext = createContext<AutoFitRegistry | null>(null);
export const AutoFitRegistryProvider = AutoFitRegistryContext.Provider;

/** Null outside a provider — callers must handle that, not assume it. */
export function useAutoFitRegistry(): AutoFitRegistry | null {
  return useContext(AutoFitRegistryContext);
}

/** The live px a text block is rendering Auto at right now: undefined before
 *  the canvas has measured it, or outside a provider entirely. */
export function useReportedAutoFitSize(key: string): number | undefined {
  const registry = useAutoFitRegistry();
  return useSyncExternalStore(
    (listener) => registry?.subscribe(key, listener) ?? (() => {}),
    () => registry?.get(key),
    () => undefined,
  );
}
