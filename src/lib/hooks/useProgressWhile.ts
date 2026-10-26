"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Work in flight that the page-wide progress bar (components/layout/
 * NavigationProgress) should reflect. A count, not a flag, so two things
 * pending at once keep the bar up until both are done.
 *
 * This exists for work whose own control is gone by the time it is slow: an
 * account switch started from a menu that has already closed, a search result
 * picked in an overlay that has already left. A control that stays on screen
 * shows its own pending state instead (ui/button's `pending`).
 */
let inFlight = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const readInFlight = () => inFlight;
const readOnServer = () => 0;

/** Whether any registered work is in flight. For the bar itself. */
export function useAnyProgress(): boolean {
  return useSyncExternalStore(subscribe, readInFlight, readOnServer) > 0;
}

/** Keep the progress bar up while `active` is true. Pass a transition's `isPending`. */
export function useProgressWhile(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    inFlight += 1;
    emit();
    return () => {
      inFlight -= 1;
      emit();
    };
  }, [active]);
}
