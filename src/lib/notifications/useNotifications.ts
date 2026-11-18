"use client";

import * as React from "react";
import {
  attach,
  detach,
  getStoreSnapshot,
  scheduleCountSync,
  storeCompleteAction,
  storeMarkAllRead,
  storeMarkRead,
  storeRefresh,
  subscribeToStore,
} from "@/lib/notifications/bell-store";

/**
 * THE single source of truth for realtime notifications (client).
 *
 * State, the Realtime channel, and the token-refresh timer all live in
 * bell-store.ts at MODULE scope, so they survive the NotificationsProvider
 * remounts that happen when the user navigates between route groups (dashboard,
 * settings, storefront list -- each is a separate Next.js layout).
 *
 * This hook is a thin adapter: it attaches to the shared store on mount,
 * subscribes via useSyncExternalStore so React re-renders on state changes,
 * and returns stable mutation callbacks. The first mount starts the bootstrap
 * HTTP call and the Realtime subscription; subsequent mounts within
 * GRACE_PERIOD_MS re-use the already-open channel and loaded state.
 *
 * Auth note: the session cookie is HttpOnly, so the browser client has no
 * token. The bootstrap route supplies a short-lived access token for
 * Realtime.setAuth(). The supabase browser client itself is loaded lazily
 * (dynamic import inside the store's start path) so the whole supabase-js
 * bundle stays out of the shell's first-paint JS.
 */

export type UseNotifications = {
  loading: boolean;
  notifications: import("@/lib/notifications/types").Notification[];
  unreadCount: number;
  status: import("@/lib/notifications/bell-store").ConnectionStatus;
  /**
   * Increments once per notification that ARRIVES over realtime (never on the
   * initial snapshot). The bell replays its ring on every change.
   */
  arrivalSeq: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** An inline action on this row finished: it is done, and read. */
  completeAction: (id: string) => void;
  refresh: () => void;
};

export function useNotifications(userId: string): UseNotifications {
  // useSyncExternalStore wires React re-renders to the module-level store.
  // subscribeToStore and getStoreSnapshot are stable module-scope references
  // so they satisfy useSyncExternalStore's requirement for stable callbacks.
  const state = React.useSyncExternalStore(
    subscribeToStore,
    getStoreSnapshot,
    // Server snapshot: the initial state before the store has loaded.
    getStoreSnapshot,
  );

  // Attach to the shared store on mount, detach on unmount. attach() increments
  // the reference count and cancels any in-progress grace-period teardown;
  // detach() decrements it and starts a grace-period timer when the count
  // reaches zero. Keyed on the user: a different user re-attaches, and the
  // store tears down the previous user's bell first (bell-store attach()).
  React.useEffect(() => {
    attach(userId);
    return () => {
      detach();
    };
  }, [userId]);

  // Stable callbacks. All mutations update the shared store state and notify
  // every subscribed provider instance; individual providers do not need their
  // own stable references beyond useCallback.
  const markRead = React.useCallback((id: string) => storeMarkRead(id), []);
  const markAllRead = React.useCallback(() => storeMarkAllRead(), []);
  const completeAction = React.useCallback((id: string) => {
    storeCompleteAction(id);
    // scheduleCountSync is exposed for callers who complete an action without a
    // realtime event arriving (the realtime handler also calls it).
    scheduleCountSync();
  }, []);
  const refresh = React.useCallback(() => storeRefresh(), []);

  return {
    loading: state.loading,
    notifications: state.notifications,
    unreadCount: state.unreadCount,
    status: state.status,
    arrivalSeq: state.arrivalSeq,
    markRead,
    markAllRead,
    completeAction,
    refresh,
  };
}
