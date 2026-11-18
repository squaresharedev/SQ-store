// Module-level state store for the notification bell.
//
// WHY THIS FILE EXISTS. Three separate Next.js layouts each mount
// NotificationsProvider (via DashboardShell): (dashboard)/layout.tsx,
// settings/layout.tsx, and storefront/(list)/layout.tsx. Navigating between
// those sections unmounts one layout's provider and mounts the next one,
// which the old per-hook design treated as a full restart: loadBellBootstrap()
// was called again, a new Realtime channel was opened, the old one was torn
// down (which emits an error status as it cleans up), and the bell flashed
// through "connecting" on every section hop.
//
// DESIGN. A single ActiveStore entry lives at module scope (one logged-in user
// per tab at a time). It carries the bell state, the Realtime channel, and the
// token-refresh timer. Consumers attach() on mount and detach() on unmount; a
// GRACE_PERIOD_MS window between the last detach and actual teardown lets a
// section hop re-attach without a re-fetch or a new channel. The store is
// owned by the user id the server-rendered shell passes in (attach(ownerId)):
// a different user attaching tears it down at once, so signing out and
// signing in as someone else never shows the previous user's bell.
//
// STATE ACCESS. getStoreSnapshot() and subscribeToStore() are module-level
// (stable references) for use with React.useSyncExternalStore. All mutations
// (markRead, markAllRead, completeAction, scheduleCountSync, refresh) live
// here too so every mounted provider instance sees the same state change.
//
// SUPABASE CLIENT. createClient() is imported dynamically inside startStore()
// (after hydration), keeping the whole supabase-js browser bundle (~60-70 KB
// gz) out of the shell's first-paint JS.

import {
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/actions";
import { loadBellBootstrap } from "@/lib/notifications/bootstrap";
import { storedNotificationAction } from "@/lib/notifications/inline-actions";
import type { Notification } from "@/lib/notifications/types";
import type { Tables } from "@/types";
import type {
  RealtimeChannel,
  RealtimePostgresInsertPayload,
  RealtimePostgresUpdatePayload,
  SupabaseClient,
} from "@supabase/supabase-js";

type NotificationRow = Tables<"notifications">;

export type ConnectionStatus = "connecting" | "live" | "error";

export type BellStoreState = {
  loading: boolean;
  notifications: Notification[];
  unreadCount: number;
  status: ConnectionStatus;
  /** Increments once per notification that ARRIVES over realtime (never on
   *  the initial snapshot). The bell replays its ring on every change. */
  arrivalSeq: number;
};

const INITIAL_STATE: BellStoreState = {
  loading: true,
  notifications: [],
  unreadCount: 0,
  status: "connecting",
  arrivalSeq: 0,
};

/** After the last provider detaches, keep the channel alive this long. 30 s
 *  is longer than any inter-section navigation; a tab reload clears state
 *  anyway, so the floor here is the slowest plausible section hop. */
const GRACE_PERIOD_MS = 30_000;

/** Access tokens live ~1 hour; refresh a little ahead of that. */
const TOKEN_REFRESH_MS = 45 * 60 * 1000;

/** Incoming notifications kept in memory (the recent list in the bell panel). */
const MAX_IN_MEMORY = 30;

/** Debounce window for the authoritative unread-count reconcile. */
const COUNT_SYNC_DEBOUNCE_MS = 400;

// Monotonic topic suffix so a fresh start() after a grace-period teardown
// never re-uses a topic from an in-flight remove (which the supabase client
// would return as the existing subscribed channel and refuse new listeners on).
let channelSeq = 0;

type ActiveStore = {
  /** The signed-in user this store was opened for (from the server-rendered
   *  shell). A different user attaching tears it down at once, grace period
   *  or not: one person's notifications and channel never pass to another. */
  ownerId: string;
  userId: string | null; // null while bootstrap is in flight
  state: BellStoreState;
  token: string | null;
  // The supabase browser client, resolved lazily in startStore().
  supabase: SupabaseClient | null;
  channel: RealtimeChannel | null;
  refreshTimer: ReturnType<typeof setInterval> | null;
  gracePeriodTimer: ReturnType<typeof setTimeout> | null;
  countTimer: ReturnType<typeof setTimeout> | null;
  // How many NotificationsProvider instances are currently attached.
  refCount: number;
  // Ids for which the bell has already rung (bounded dedup).
  ringedIds: Set<string>;
};

// The one active store (at most one per tab).
let active: ActiveStore | null = null;

/**
 * State-change listeners for useSyncExternalStore. Module-level, not per
 * store: a subscriber registered while one store is active must still hear
 * about the next one (after a teardown, or a switch to another user).
 */
const listeners = new Set<() => void>();

function emptyStore(ownerId: string): ActiveStore {
  return {
    ownerId,
    userId: null,
    state: { ...INITIAL_STATE },
    token: null,
    supabase: null,
    channel: null,
    refreshTimer: null,
    gracePeriodTimer: null,
    countTimer: null,
    refCount: 0,
    ringedIds: new Set(),
  };
}

function setState(store: ActiveStore, patch: Partial<BellStoreState>): void {
  store.state = { ...store.state, ...patch };
  notify(store);
}

// A store that is no longer the active one has nobody left to tell.
function notify(store: ActiveStore): void {
  if (active === store) notifyAll();
}

function notifyAll(): void {
  for (const cb of listeners) cb();
}

// ---- public API for useSyncExternalStore ------------------------------------

/** Stable reference used as the subscribe arg to useSyncExternalStore. */
export function subscribeToStore(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** Stable reference used as the getSnapshot arg to useSyncExternalStore. */
export function getStoreSnapshot(): BellStoreState {
  return active?.state ?? INITIAL_STATE;
}

// ---- lifecycle --------------------------------------------------------------

/**
 * Called from the useEffect in useNotifications on mount, with the id of the
 * user the page was rendered for. A store left open for someone else (a
 * sign-out and a different sign-in inside the grace period, which a client
 * navigation survives) is torn down first.
 */
export function attach(ownerId: string): void {
  if (active && active.ownerId !== ownerId) teardown();
  if (!active) {
    active = emptyStore(ownerId);
    notifyAll();
    void startStore(active);
  } else if (active.gracePeriodTimer !== null) {
    // A new mount within the grace window: cancel the scheduled teardown.
    clearTimeout(active.gracePeriodTimer);
    active.gracePeriodTimer = null;
  }
  active.refCount++;
}

/** Called from the useEffect cleanup in useNotifications on unmount. */
export function detach(): void {
  if (!active) return;
  active.refCount = Math.max(0, active.refCount - 1);
  if (active.refCount === 0) {
    // Start the grace period. If another mount arrives before it fires, the
    // timer is cancelled in attach(). If it fires, the channel is closed.
    active.gracePeriodTimer = setTimeout(teardown, GRACE_PERIOD_MS);
  }
}

function teardown(): void {
  if (!active) return;
  const store = active;
  active = null;

  if (store.channel && store.supabase) {
    void store.supabase.removeChannel(store.channel);
  }
  if (store.refreshTimer) clearInterval(store.refreshTimer);
  if (store.countTimer) clearTimeout(store.countTimer);
  if (store.gracePeriodTimer) clearTimeout(store.gracePeriodTimer);
  // Anyone still subscribed now reads INITIAL_STATE, never the old bell.
  notifyAll();
}

// ---- store startup ----------------------------------------------------------

async function startStore(store: ActiveStore): Promise<void> {
  const { snapshot, token } = await loadBellBootstrap();

  // Check whether this store is still the active one (a new user may have
  // triggered a teardown + re-create since the fetch began).
  if (active !== store) return;

  if (!snapshot) {
    setState(store, { loading: false, status: "error" });
    return;
  }

  store.token = token;
  store.userId = snapshot.userId;
  setState(store, {
    notifications: snapshot.notifications,
    unreadCount: snapshot.unreadCount,
    loading: false,
  });

  if (!token) {
    // No token: show the static snapshot; RLS-filtered realtime is not possible
    // without one, so do not open an unauthenticated subscription.
    setState(store, { status: "error" });
    return;
  }

  // Load the supabase browser client only now, after hydration, so the whole
  // supabase-js bundle stays out of the shell's first-paint JS.
  const { createClient } = await import("@/lib/supabase/client");
  if (active !== store) return; // torn down while importing

  store.supabase = createClient();
  await store.supabase.realtime.setAuth(token);
  if (active !== store) return;

  const filter = `user_id=eq.${snapshot.userId}`;
  store.channel = store.supabase
    .channel(`notifications:${snapshot.userId}:${channelSeq++}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter },
      (payload: RealtimePostgresInsertPayload<NotificationRow>) => {
        onInsert(store, payload.new);
      },
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "notifications", filter },
      (payload: RealtimePostgresUpdatePayload<NotificationRow>) => {
        onUpdate(store, payload.new);
      },
    )
    .subscribe((channelStatus) => {
      if (active !== store) return;
      if (channelStatus === "SUBSCRIBED") setState(store, { status: "live" });
      else if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT")
        setState(store, { status: "error" });
    });

  // Keep the realtime auth token fresh so a long-lived tab keeps receiving
  // events after a rotation.
  store.refreshTimer = setInterval(async () => {
    if (active !== store || !store.supabase) return;
    const { token: fresh } = await loadBellBootstrap();
    if (active === store && fresh) {
      store.token = fresh;
      await store.supabase.realtime.setAuth(fresh);
    }
  }, TOKEN_REFRESH_MS);
}

// ---- realtime event handlers ------------------------------------------------

function asNotification(row: NotificationRow): Notification {
  const stored = storedNotificationAction(row.data);
  return {
    ...(row as unknown as Notification),
    action: stored ? { kind: stored.kind, status: "pending" } : null,
  };
}

function onInsert(store: ActiveStore, row: NotificationRow): void {
  const incoming = asNotification(row);
  const alreadyPresent = store.state.notifications.some((n) => n.id === incoming.id);
  if (!alreadyPresent) {
    const next = [incoming, ...store.state.notifications].slice(0, MAX_IN_MEMORY);
    store.state = { ...store.state, notifications: next };
  }

  // Ring once per genuinely new unread row. Use ringedIds rather than a flag
  // inside the updater to guard StrictMode double-invoke correctly.
  if (!incoming.read && !store.ringedIds.has(incoming.id)) {
    if (store.ringedIds.size >= MAX_IN_MEMORY * 2) store.ringedIds = new Set();
    store.ringedIds.add(incoming.id);
    store.state = { ...store.state, arrivalSeq: store.state.arrivalSeq + 1 };
  }

  if (!incoming.read) {
    store.state = { ...store.state, unreadCount: store.state.unreadCount + 1 };
  }
  notify(store);
  scheduleCountSyncFor(store);
}

function onUpdate(store: ActiveStore, row: NotificationRow): void {
  const updated = asNotification(row);
  // An UPDATE is a read-flag change. Keep the action status the client already
  // resolved for this row (server "done" must not regress to "pending").
  const notifications = store.state.notifications.map((n) =>
    n.id === updated.id ? { ...updated, action: n.action } : n,
  );
  setState(store, { notifications });
  scheduleCountSyncFor(store);
}

// ---- debounced count reconcile ----------------------------------------------

function scheduleCountSyncFor(store: ActiveStore): void {
  if (store.countTimer) clearTimeout(store.countTimer);
  store.countTimer = setTimeout(() => {
    store.countTimer = null;
    void fetchUnreadCount().then((count) => {
      if (active === store) setState(store, { unreadCount: count });
    });
  }, COUNT_SYNC_DEBOUNCE_MS);
}

/** Exposed so the hook can call it directly after mutations that may change
 *  the count without a realtime event (e.g. completeAction). */
export function scheduleCountSync(): void {
  if (active) scheduleCountSyncFor(active);
}

// ---- mutations --------------------------------------------------------------

export function storeMarkRead(id: string): void {
  if (!active) return;
  const store = active;

  // Skip the action and the badge decrement when the row is already read.
  // The server action costs a DB round-trip even for a no-op update, and the
  // optimistic decrement would take the badge below the true count.
  const target = store.state.notifications.find((n) => n.id === id);
  if (!target || target.read) return;

  setState(store, {
    notifications: store.state.notifications.map((n) =>
      n.id === id ? { ...n, read: true } : n,
    ),
    unreadCount: Math.max(0, store.state.unreadCount - 1), // optimistic
  });
  void markNotificationRead(id).then((res) => {
    if (active === store && res) setState(store, { unreadCount: res.unreadCount });
  });
}

export function storeMarkAllRead(): void {
  if (!active) return;
  const store = active;
  setState(store, {
    notifications: store.state.notifications.map((n) => ({ ...n, read: true })),
    unreadCount: 0, // optimistic
  });
  void markAllNotificationsRead().then((res) => {
    if (active === store && res) setState(store, { unreadCount: res.unreadCount });
  });
}

/** An inline action on this notification finished: mark it done and read. */
export function storeCompleteAction(id: string): void {
  if (!active) return;
  const store = active;
  setState(store, {
    notifications: store.state.notifications.map((n) =>
      n.id === id
        ? { ...n, read: true, action: n.action ? { ...n.action, status: "done" } : n.action }
        : n,
    ),
  });
  scheduleCountSyncFor(store);
}

export function storeRefresh(): void {
  if (!active) return;
  const store = active;
  void loadBellBootstrap().then(({ snapshot: snap }) => {
    if (active !== store || !snap) return;
    setState(store, {
      notifications: snap.notifications,
      unreadCount: snap.unreadCount,
    });
  });
}

/** Test-only: reset all module state between cases. */
export function __clearBellStore(): void {
  if (active) {
    if (active.refreshTimer) clearInterval(active.refreshTimer);
    if (active.countTimer) clearTimeout(active.countTimer);
    if (active.gracePeriodTimer) clearTimeout(active.gracePeriodTimer);
  }
  active = null;
  listeners.clear();
}
