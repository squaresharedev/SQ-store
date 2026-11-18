// @vitest-environment node
/**
 * Bell store lifecycle tests.
 *
 * Cover the two lifecycle guarantees the store documentation promises:
 *
 *   GRACE-PERIOD REUSE: re-attaching within 30 s cancels the teardown and
 *   reuses the already-open channel, so a section hop never re-bootstraps.
 *
 *   USER-KEYING: after the full grace period the store is torn down; a new
 *   attach starts from INITIAL_STATE, so a sign-out / sign-in never shows
 *   the previous user's notifications.
 *
 * The supabase client and bootstrap fetch are mocked throughout. The tests use
 * null-snapshot bootstraps so startStore exits before opening a Realtime
 * channel; this keeps the mocks minimal while still exercising every timer
 * and reference-count branch in the lifecycle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted so the vi.mock factories below can reference them.
// Typed as the full BellBootstrap return (snapshot may be null or populated).
const mockLoadBellBootstrap = vi.hoisted(() =>
  vi.fn<() => Promise<{ snapshot: { userId: string; notifications: unknown[]; unreadCount: number } | null; token: string | null }>>(),
);

vi.mock("@/lib/notifications/bootstrap", () => ({
  loadBellBootstrap: mockLoadBellBootstrap,
  NOTIFICATIONS_BOOTSTRAP_API_PATH: "/api/notifications/bootstrap",
}));

// The supabase client is loaded lazily inside startStore(); mock it in case a
// test path reaches the token-present branch.
vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Server-only imports -- bell-store imports these at module scope; mock them so
// the module can be loaded in a node test environment.
const mockMarkNotificationRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/notifications/actions", () => ({
  fetchUnreadCount: vi.fn().mockResolvedValue(0),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: mockMarkNotificationRead,
}));

vi.mock("@/lib/notifications/inline-actions", () => ({
  storedNotificationAction: vi.fn().mockReturnValue(null),
  NOTIFICATION_ACTION_KINDS: ["team.acceptInvite"],
}));

import {
  __clearBellStore,
  attach,
  detach,
  getStoreSnapshot,
  storeMarkRead,
  subscribeToStore,
} from "@/lib/notifications/bell-store";

// 30 s + 1 ms so timers that fire exactly at the 30 000 ms mark are included.
const AFTER_GRACE = 30_001;

beforeEach(() => {
  __clearBellStore();
  vi.useFakeTimers();
  // Null snapshot: no token, startStore returns before the realtime branch.
  // loading transitions from true -> false once the bootstrap resolves.
  mockLoadBellBootstrap.mockResolvedValue({ snapshot: null, token: null });
});

afterEach(() => {
  // Clear any live timers before restoring real time, so nothing leaks between
  // cases. __clearBellStore cancels the grace-period timer if one is running.
  __clearBellStore();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Grace-period reuse
// ---------------------------------------------------------------------------

describe("bell store -- grace-period reuse", () => {
  it("re-attaching within the grace window cancels teardown and keeps the loaded state", async () => {
    // First mount: a store is created and startStore() is called.
    attach("user-a");
    // Let the null-snapshot bootstrap settle: loading -> false, status -> error.
    await vi.runAllTimersAsync();
    expect(getStoreSnapshot().loading).toBe(false);

    // Detach: refCount falls to 0 and the 30 s grace timer starts.
    detach();

    // A new provider mounts 5 s into the grace window (section hop).
    vi.advanceTimersByTime(5_000);
    attach("user-a");

    // Advance well past the original teardown deadline; the timer was cancelled.
    vi.advanceTimersByTime(AFTER_GRACE);

    // The post-bootstrap state must still be present -- not reset to loading.
    expect(getStoreSnapshot().loading).toBe(false);
  });

  it("two providers sharing one store do not tear it down until both detach", async () => {
    // Three layouts each mount NotificationsProvider, each calling attach().
    attach("user-a"); // layout A (dashboard)
    attach("user-a"); // layout B (settings)
    await vi.runAllTimersAsync();
    expect(getStoreSnapshot().loading).toBe(false);

    // Layout A navigates away: refCount falls to 1; no grace timer starts yet.
    detach();
    vi.advanceTimersByTime(AFTER_GRACE);
    // Layout B is still alive: the loaded state must be preserved.
    expect(getStoreSnapshot().loading).toBe(false);

    // Layout B also navigates away: refCount falls to 0, grace timer starts.
    detach();
    vi.advanceTimersByTime(AFTER_GRACE);
    // Both are gone and the grace period expired: a new attach starts fresh.
    attach("user-a");
    expect(getStoreSnapshot().loading).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// User-keying: a new session after a teardown is clean
// ---------------------------------------------------------------------------

describe("bell store -- user-keying", () => {
  it("re-attaching after the full grace period starts from INITIAL_STATE", async () => {
    // Simulate a signed-in session loading and then the user navigating away.
    attach("user-a");
    await vi.runAllTimersAsync();
    expect(getStoreSnapshot().loading).toBe(false);

    // Let the grace period expire: the store is fully torn down.
    detach();
    vi.advanceTimersByTime(AFTER_GRACE);

    // A new provider mounts (page reload, sign-in as a different user, etc.).
    attach("user-a");

    // Before the new bootstrap resolves, the state must be INITIAL_STATE.
    // This is the user-keying guarantee: no data from the previous session leaks.
    const fresh = getStoreSnapshot();
    expect(fresh.loading).toBe(true);
    expect(fresh.unreadCount).toBe(0);
    expect(fresh.notifications).toHaveLength(0);
    expect(fresh.status).toBe("connecting");
  });

  it("cancelling the grace period mid-countdown keeps the PREVIOUS session's data", async () => {
    // User navigates away and comes back quickly (browser back-forward, tab switch).
    attach("user-a");
    await vi.runAllTimersAsync();
    const snapshot = getStoreSnapshot();
    expect(snapshot.loading).toBe(false);

    detach();
    vi.advanceTimersByTime(10_000); // halfway through the grace period
    attach("user-a"); // back already

    // Data from the previous session is still there -- no flash to loading.
    expect(getStoreSnapshot().loading).toBe(false);
    expect(getStoreSnapshot().status).toBe(snapshot.status);
  });

  it("a DIFFERENT user attaching inside the grace period never sees the previous bell", async () => {
    // Sign-out then a different sign-in within 30 s: a client navigation keeps
    // module state, so only the owner check stands between the two users.
    attach("user-a");
    await vi.runAllTimersAsync();
    expect(getStoreSnapshot().loading).toBe(false);
    const listener = vi.fn();
    const unsubscribe = subscribeToStore(listener);

    detach();
    vi.advanceTimersByTime(5_000); // well inside the grace period
    attach("user-b");

    const fresh = getStoreSnapshot();
    expect(fresh.loading).toBe(true);
    expect(fresh.notifications).toHaveLength(0);
    // A fresh bootstrap for user-b, not a reuse of user-a's.
    expect(mockLoadBellBootstrap).toHaveBeenCalledTimes(2);
    // Subscribers registered under user-a's store still hear the switch.
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// storeMarkRead: already-read guard
// ---------------------------------------------------------------------------

const NOTIF_UNREAD = {
  id: "aa000000-0000-4000-8000-000000000001",
  read: false,
  type: "system",
  title: "Test",
  body: null,
  data: null,
  created_at: "2026-01-01T00:00:00Z",
  user_id: "user-a",
  action: null,
};

const NOTIF_READ = { ...NOTIF_UNREAD, id: "bb000000-0000-4000-8000-000000000002", read: true };

describe("storeMarkRead -- already-read guard", () => {
  beforeEach(() => {
    mockMarkNotificationRead.mockResolvedValue({ ok: true, unreadCount: 0 });
  });

  it("calls the action and decrements the badge for an unread notification", async () => {
    // Bootstrap the store with one unread notification.
    mockLoadBellBootstrap.mockResolvedValue({
      snapshot: { userId: "user-a", notifications: [NOTIF_UNREAD], unreadCount: 1 },
      token: null,
    });
    attach("user-a");
    await vi.runAllTimersAsync();
    expect(getStoreSnapshot().unreadCount).toBe(1);

    storeMarkRead(NOTIF_UNREAD.id);
    await vi.runAllTimersAsync();

    // Optimistic decrement.
    expect(getStoreSnapshot().unreadCount).toBe(0);
    // Server action was called.
    expect(mockMarkNotificationRead).toHaveBeenCalledWith(NOTIF_UNREAD.id);
  });

  it("does NOT call the action or change the badge for an already-read notification", async () => {
    mockLoadBellBootstrap.mockResolvedValue({
      snapshot: { userId: "user-a", notifications: [NOTIF_READ], unreadCount: 0 },
      token: null,
    });
    attach("user-a");
    await vi.runAllTimersAsync();
    expect(getStoreSnapshot().unreadCount).toBe(0);

    storeMarkRead(NOTIF_READ.id);
    await vi.runAllTimersAsync();

    // Badge unchanged, action never called.
    expect(getStoreSnapshot().unreadCount).toBe(0);
    expect(mockMarkNotificationRead).not.toHaveBeenCalled();
  });

  it("does NOT call the action when the notification id is not in the store", async () => {
    attach("user-a");
    await vi.runAllTimersAsync();

    storeMarkRead("non-existent-id");
    await vi.runAllTimersAsync();

    expect(mockMarkNotificationRead).not.toHaveBeenCalled();
  });

  it("does NOT call the action when no store is active", async () => {
    storeMarkRead("some-id");
    await vi.runAllTimersAsync();
    expect(mockMarkNotificationRead).not.toHaveBeenCalled();
  });
});
