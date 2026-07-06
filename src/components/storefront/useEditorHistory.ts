"use client";

import { useRef, useState } from "react";

const HISTORY_LIMIT = 50;
const COALESCE_WINDOW_MS = 1200;

/**
 * Linear undo/redo history over an immutable editor snapshot. Call `record`
 * with the CURRENT snapshot BEFORE applying a change; consecutive records
 * sharing a coalesce key within a short window collapse into one entry, so a
 * burst of per-keystroke or per-drag-tick edits undoes as a single step.
 * `undo`/`redo` take the current snapshot (it moves to the opposite stack)
 * and return the snapshot to restore, or null when the stack is empty.
 *
 * The stacks live in a ref and are mutated synchronously, so two undos fired
 * in the same task (keyboard key-repeat under batching) each see the already-
 * updated stack — state only mirrors the canUndo/canRedo booleans, and only
 * changes when those flip, so coalesced records cause zero re-renders.
 */
export function useEditorHistory<T>() {
  const stacks = useRef<{ past: T[]; future: T[] }>({ past: [], future: [] });
  const meta = useRef<{ key: string | null; time: number }>({
    key: null,
    time: 0,
  });
  // Bitmask: 1 = canUndo, 2 = canRedo. Same-value sets bail out re-rendering.
  const [flags, setFlags] = useState(0);

  function syncFlags() {
    const next =
      (stacks.current.past.length > 0 ? 1 : 0) |
      (stacks.current.future.length > 0 ? 2 : 0);
    setFlags((current) => (current === next ? current : next));
  }

  function record(snapshot: T, coalesceKey?: string) {
    const now = Date.now();
    const last = meta.current;
    const coalesce =
      coalesceKey !== undefined &&
      coalesceKey === last.key &&
      now - last.time < COALESCE_WINDOW_MS;
    if (!coalesce) {
      const past = stacks.current.past;
      stacks.current.past = [...past.slice(-(HISTORY_LIMIT - 1)), snapshot];
    }
    meta.current = { key: coalesceKey ?? null, time: now };
    // Any new change invalidates the redo branch.
    stacks.current.future = [];
    syncFlags();
  }

  function undo(current: T): T | null {
    const { past, future } = stacks.current;
    if (past.length === 0) return null;
    const previous = past[past.length - 1];
    stacks.current = { past: past.slice(0, -1), future: [...future, current] };
    // Never coalesce across an undo boundary.
    meta.current = { key: null, time: 0 };
    syncFlags();
    return previous;
  }

  function redo(current: T): T | null {
    const { past, future } = stacks.current;
    if (future.length === 0) return null;
    const next = future[future.length - 1];
    stacks.current = { past: [...past, current], future: future.slice(0, -1) };
    meta.current = { key: null, time: 0 };
    syncFlags();
    return next;
  }

  return {
    record,
    undo,
    redo,
    canUndo: (flags & 1) !== 0,
    canRedo: (flags & 2) !== 0,
  };
}
