"use client";

import { useSyncExternalStore } from "react";

/**
 * The current time, to the minute, for text that says how long ago something
 * was ("3 days ago").
 *
 * Null on the server and during hydration, the real time afterwards, the same
 * shape as useIsMacPlatform and for the same reason: "how long ago" depends on
 * a clock the server and the browser do not share, so rendering it on the
 * server risks a hydration mismatch, and a placeholder for one frame is the
 * honest alternative to a wrong answer. Read through useSyncExternalStore
 * rather than setState in an effect, so nothing here writes state from inside
 * one.
 *
 * It ticks once a minute, which is as fine as any "ago" text needs, so a tab
 * left open all day does not keep saying "5 minutes ago".
 *
 * ONE SHARED INTERVAL across all subscribers. The previous version started a
 * setInterval per subscriber, so a list of N order rows registered N timers
 * and fired N re-renders every minute. A module-level set + a single interval
 * (started by the first subscriber, cleared by the last) gives every hook the
 * same tick at a fraction of the cost.
 */
const MINUTE_MS = 60_000;

/** All live onChange callbacks, one per useSyncExternalStore subscriber. */
const listeners = new Set<() => void>();
/** The one shared timer, or null when nothing is subscribed. */
let moduleTimer: ReturnType<typeof setInterval> | null = null;

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (!moduleTimer) {
    moduleTimer = setInterval(() => {
      listeners.forEach((fn) => fn());
    }, MINUTE_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && moduleTimer !== null) {
      clearInterval(moduleTimer);
      moduleTimer = null;
    }
  };
}

/** No-op subscribe used when the hook is disabled. */
const emptySubscribe = () => () => {};

/** The minute we are in, as a number: stable within a minute, as a store's
 *  snapshot must be (a fresh Date each call would re-render forever). */
const readMinute = () => Math.floor(Date.now() / MINUTE_MS);
const UNKNOWN_ON_SERVER = () => null;

/**
 * The current time, to the minute.
 *
 * Pass `enabled={false}` to skip the subscription entirely (the hook returns
 * null and nothing subscribes to the shared timer). Useful for rows that only
 * read `now` in a specific view, so rows not in that view do not add listeners.
 */
export function useNow(enabled = true): Date | null {
  const minute = useSyncExternalStore(
    enabled ? subscribe : emptySubscribe,
    enabled ? readMinute : UNKNOWN_ON_SERVER,
    UNKNOWN_ON_SERVER,
  );
  return minute === null ? null : new Date(minute * MINUTE_MS);
}
