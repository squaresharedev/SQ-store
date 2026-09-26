"use client";

import { useCallback, useSyncExternalStore } from "react";
import { fixProgressStorageKey } from "@/lib/moderation/fix-fields";

/**
 * The flagged parts of a paused product the seller has already changed AND
 * saved, remembered for this browser session.
 *
 * Why remember at all: saving reloads the form from the database, and the
 * form can only tell "changed" by comparing against what it loaded. Without
 * this, every part the seller just fixed would snap back to "Needs changes"
 * the moment they saved it. A convenience, so sessionStorage and nothing
 * more: it can come back empty or throw (private windows, blocked storage),
 * and then an in-memory copy covers the rest of the visit.
 *
 * Read through useSyncExternalStore so the server render (which has no
 * storage) and the first client render agree, and the remembered parts
 * arrive straight after hydration without a second pass through an effect.
 */

const EMPTY: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
/** Parsed snapshots, keyed by storage key and what they were built from, so a
 *  read that finds nothing new returns the SAME set (the store contract). */
const snapshots = new Map<
  string,
  { raw: string | null; memory: ReadonlySet<string> | undefined; set: ReadonlySet<string> }
>();
/** What was remembered when storage refused the write. Lives as long as the
 *  page, and is folded into every read. */
const memory = new Map<string, ReadonlySet<string>>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function read(key: string): ReadonlySet<string> {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(key);
  } catch {
    return memory.get(key) ?? EMPTY;
  }
  const remembered = memory.get(key);
  const cached = snapshots.get(key);
  if (cached && cached.raw === raw && cached.memory === remembered) return cached.set;
  let stored: string[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      stored = parsed.filter((value): value is string => typeof value === "string");
    }
  } catch {
    // A value someone else wrote under our key: ignore it.
  }
  const set: ReadonlySet<string> =
    stored.length === 0 && !remembered ? EMPTY : new Set([...stored, ...(remembered ?? [])]);
  snapshots.set(key, { raw, memory: remembered, set });
  return set;
}

export function useFixProgress(decisionId: string | null | undefined): {
  saved: ReadonlySet<string>;
  remember: (fields: readonly string[]) => void;
} {
  const key = decisionId ? fixProgressStorageKey(decisionId) : null;
  const saved = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : EMPTY),
    () => EMPTY,
  );

  const remember = useCallback(
    (fields: readonly string[]) => {
      if (!key || fields.length === 0) return;
      const next = new Set([...read(key), ...fields]);
      try {
        window.sessionStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        memory.set(key, next);
      }
      for (const listener of listeners) listener();
    },
    [key],
  );

  return { saved, remember };
}
