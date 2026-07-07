"use client";

import * as React from "react";
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
} from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  fetchNotificationSnapshot,
  fetchUnreadCount,
  getRealtimeToken,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/actions";
import type { Notification } from "@/lib/notifications/types";
import type { Tables } from "@/types";

/**
 * THE single source of truth for realtime notifications (client). One instance
 * (mounted by NotificationsProvider) owns:
 *   - initial load: recent list + authoritative unread count (server action).
 *   - a Realtime subscription to postgres_changes on `notifications`, filtered
 *     to the current user, for INSERT + UPDATE. RLS is enforced on the
 *     subscription too, so only the user's own rows ever arrive.
 *   - the unread count: optimistic for snappiness, then reconciled against an
 *     authoritative server count (debounced, so a burst of events — e.g. a
 *     "mark all read" echo — collapses to one refetch and can't drift).
 *   - clean lifecycle: subscribe on mount, unsubscribe + remove channel on
 *     unmount, refresh the auth token before expiry.
 *
 * Auth note: the session cookie is HttpOnly, so the browser client has no token.
 * We fetch the user's access token from the server and hand it to Realtime via
 * setAuth() — without it, an RLS-filtered subscription would receive nothing.
 */

type NotificationRow = Tables<"notifications">;
type ConnectionStatus = "connecting" | "live" | "error";

const MAX_IN_MEMORY = 30;
const TOKEN_REFRESH_MS = 45 * 60 * 1000; // access tokens live ~1h
const COUNT_SYNC_DEBOUNCE_MS = 400;

// Monotonic id so each subscription gets its OWN channel topic. Reusing a topic
// (e.g. across a StrictMode remount before the old channel finishes removing)
// makes supabase return the cached, already-subscribed channel, and adding a
// postgres_changes listener to it throws "cannot add ... after subscribe()".
let channelSeq = 0;

function asNotification(row: NotificationRow): Notification {
  return row as Notification;
}

export type UseNotifications = {
  loading: boolean;
  notifications: Notification[];
  unreadCount: number;
  status: ConnectionStatus;
  markRead: (id: string) => void;
  markAllRead: () => void;
  refresh: () => void;
};

export function useNotifications(): UseNotifications {
  const [notifications, setNotifications] = React.useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [status, setStatus] = React.useState<ConnectionStatus>("connecting");

  // Stable browser client (realtime only — reads go through server actions,
  // since this client has no session of its own).
  const supabaseRef = React.useRef<ReturnType<typeof createClient> | null>(null);
  if (supabaseRef.current === null) supabaseRef.current = createClient();
  const supabase = supabaseRef.current;

  const mountedRef = React.useRef(true);
  const countTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced authoritative unread-count reconcile. Coalesces bursts (a single
  // refetch after the last event), so echoes of the client's own writes and
  // cross-device changes both converge to the true value without delta math.
  const scheduleCountSync = React.useCallback(() => {
    if (countTimerRef.current) clearTimeout(countTimerRef.current);
    countTimerRef.current = setTimeout(() => {
      void fetchUnreadCount().then((count) => {
        if (mountedRef.current) setUnreadCount(count);
      });
    }, COUNT_SYNC_DEBOUNCE_MS);
  }, []);

  const upsertFromInsert = React.useCallback(
    (row: NotificationRow) => {
      const incoming = asNotification(row);
      setNotifications((prev) => {
        if (prev.some((n) => n.id === incoming.id)) return prev;
        return [incoming, ...prev].slice(0, MAX_IN_MEMORY);
      });
      if (!incoming.read) setUnreadCount((c) => c + 1); // optimistic
      scheduleCountSync(); // authoritative reconcile
    },
    [scheduleCountSync],
  );

  const applyUpdate = React.useCallback(
    (next: NotificationRow) => {
      const updated = asNotification(next);
      setNotifications((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n)),
      );
      scheduleCountSync();
    },
    [scheduleCountSync],
  );

  const refresh = React.useCallback(() => {
    void fetchNotificationSnapshot().then((snap) => {
      if (!mountedRef.current || !snap) return;
      setNotifications(snap.notifications);
      setUnreadCount(snap.unreadCount);
    });
  }, []);

  React.useEffect(() => {
    mountedRef.current = true;
    // Per-run flag: a stale start() from a StrictMode double-invoke must bail
    // even though mountedRef gets re-set to true by the second mount. Without
    // this, two start()s race and both try to build the same channel.
    let active = true;
    let channel: RealtimeChannel | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    async function start() {
      const snap = await fetchNotificationSnapshot();
      if (!active) return;
      if (!snap) {
        setLoading(false);
        setStatus("error");
        return;
      }
      setNotifications(snap.notifications);
      setUnreadCount(snap.unreadCount);
      setLoading(false);

      const token = await getRealtimeToken();
      if (!active) return;
      if (!token) {
        // No token → cannot authorize an RLS-filtered subscription. Keep the
        // static snapshot rather than opening an unauthenticated stream.
        setStatus("error");
        return;
      }
      await supabase.realtime.setAuth(token);
      if (!active) return;

      const filter = `user_id=eq.${snap.userId}`;
      // Unique topic per run so we never re-attach to a cached channel.
      channel = supabase
        .channel(`notifications:${snap.userId}:${channelSeq++}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "notifications", filter },
          (payload: RealtimePostgresInsertPayload<NotificationRow>) =>
            upsertFromInsert(payload.new),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "notifications", filter },
          (payload: RealtimePostgresUpdatePayload<NotificationRow>) =>
            applyUpdate(payload.new),
        )
        .subscribe((channelStatus) => {
          if (!active) return;
          if (channelStatus === "SUBSCRIBED") setStatus("live");
          else if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT")
            setStatus("error");
        });

      // Keep the realtime auth token fresh so a long-lived tab keeps receiving
      // events after a token rotation.
      refreshTimer = setInterval(async () => {
        const fresh = await getRealtimeToken();
        if (active && fresh) await supabase.realtime.setAuth(fresh);
      }, TOKEN_REFRESH_MS);
    }

    void start();

    return () => {
      active = false;
      mountedRef.current = false;
      if (refreshTimer) clearInterval(refreshTimer);
      if (countTimerRef.current) clearTimeout(countTimerRef.current);
      if (channel) void supabase.removeChannel(channel);
    };
    // Mount once: the provider renders a single stable instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markRead = React.useCallback(
    (id: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === id && !n.read ? { ...n, read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1)); // optimistic
      void markNotificationRead(id).then((res) => {
        if (mountedRef.current && res) setUnreadCount(res.unreadCount);
      });
    },
    [],
  );

  const markAllRead = React.useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    setUnreadCount(0); // optimistic
    void markAllNotificationsRead().then((res) => {
      if (mountedRef.current && res) setUnreadCount(res.unreadCount);
    });
  }, []);

  return {
    loading,
    notifications,
    unreadCount,
    status,
    markRead,
    markAllRead,
    refresh,
  };
}
