"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A per-device yes/no remembered in localStorage: collapsed, hidden, dismissed.
 * For conveniences that are genuinely about THIS browser, never for facts that
 * must follow a person between devices (those live on the profile, like
 * `onboarding_completed_at`).
 *
 * Same idea as the designer's mobile-notice flag (StorefrontDesigner.tsx),
 * generalised by key. Read through `useSyncExternalStore`, so the stored answer
 * arrives on the first render after hydration with no effect chasing it; the
 * server snapshot is `false`. A boolean snapshot compares by value, so reading
 * storage on each call is already stable without a cache.
 *
 * Storage that throws (private mode, blocked site data) must not make a click
 * do nothing, so a failed write is remembered in memory for the rest of the
 * visit instead; only the memory across visits is lost.
 */
const unsavedFallback = new Map<string, boolean>();
const listeners = new Map<string, Set<() => void>>();

function readFlag(key: string): boolean {
  const fallback = unsavedFallback.get(key);
  if (fallback !== undefined) return fallback;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    if (value) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
    unsavedFallback.delete(key);
  } catch {
    unsavedFallback.set(key, value);
  }
  for (const listener of listeners.get(key) ?? []) listener();
}

export function useStoredFlag(key: string): [boolean, (value: boolean) => void] {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const set = listeners.get(key) ?? new Set<() => void>();
      listeners.set(key, set);
      set.add(onChange);
      return () => {
        set.delete(onChange);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => readFlag(key),
    () => false,
  );
  const setValue = useCallback((next: boolean) => writeFlag(key, next), [key]);
  return [value, setValue];
}
