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
 */
const MINUTE_MS = 60_000;

function subscribe(onChange: () => void): () => void {
  const timer = setInterval(onChange, MINUTE_MS);
  return () => clearInterval(timer);
}

/** The minute we are in, as a number: stable within a minute, as a store's
 *  snapshot must be (a fresh Date each call would re-render forever). */
const readMinute = () => Math.floor(Date.now() / MINUTE_MS);
const UNKNOWN_ON_SERVER = () => null;

export function useNow(): Date | null {
  const minute = useSyncExternalStore(subscribe, readMinute, UNKNOWN_ON_SERVER);
  return minute === null ? null : new Date(minute * MINUTE_MS);
}
