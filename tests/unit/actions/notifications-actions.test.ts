// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks ---------------------------------------------------------------

const getUserMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUserMock(),
}));

const getUnreadCountMock = vi.fn();
const getNotificationSnapshotMock = vi.fn();
const getNotificationPageMock = vi.fn();
vi.mock("@/lib/notifications/queries", () => ({
  getUnreadCount: () => getUnreadCountMock(),
  getNotificationSnapshot: () => getNotificationSnapshotMock(),
  getNotificationPage: (...args: unknown[]) => getNotificationPageMock(...args),
}));

// Chainable fake Supabase client (regular/user client).
// db is also thenable for: "const { error } = await supabase.from(...).update(...).eq(...)"
const dbFn = vi.fn();
const db: any = {};
for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
  db[m] = vi.fn(() => db);
}
db.single = vi.fn(() => dbFn());
db.maybeSingle = vi.fn(() => dbFn());
db.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
  Promise.resolve(dbFn()).then(resolve, reject);
db.auth = {
  getSession: vi.fn(),
};

// Non-thenable wrapper: prevents async () => db from unwrapping via thenable protocol.
// auth is delegated so supabase.auth.getSession() works in getRealtimeToken.
const clientWrapper = {
  from: (...args: unknown[]) => (db.from as (...a: unknown[]) => unknown)(...args),
  auth: db.auth,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clientWrapper,
}));

// Fake admin client (for createNotification in create.ts).
// createAdminClient is called WITHOUT await (sync), so the factory is also sync.
const adminDbFn = vi.fn();
const adminDb: any = {};
for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
  adminDb[m] = vi.fn(() => adminDb);
}
adminDb.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
  Promise.resolve(adminDbFn()).then(resolve, reject);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => adminDb,
}));

// ---- imports -------------------------------------------------------------

import { markNotificationRead, getRealtimeToken } from "@/lib/notifications/actions";
import { createNotification } from "@/lib/notifications/create";

// ---- test constants ------------------------------------------------------

const USER_ID = "10000000-0000-4000-8000-000000000001";
const NOTIFICATION_ID = "70000000-0000-4000-8000-000000000007";

const USER = { id: USER_ID, email: "user@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  dbFn.mockResolvedValue({ data: null, error: null });
  adminDbFn.mockResolvedValue({ data: null, error: null });
  for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
    db[m].mockReturnValue(db);
    adminDb[m].mockReturnValue(adminDb);
  }
  db.single.mockImplementation(() => dbFn());
  db.maybeSingle.mockImplementation(() => dbFn());
  db.auth.getSession.mockResolvedValue({ data: { session: null } });
  getUnreadCountMock.mockResolvedValue(0);
  getNotificationSnapshotMock.mockResolvedValue(null);
  getNotificationPageMock.mockResolvedValue({ notifications: [], nextCursor: null });
});

// ==========================================================================
// markNotificationRead
// ==========================================================================

describe("markNotificationRead", () => {
  it("signed out returns {ok:false, unreadCount:0}", async () => {
    getUserMock.mockResolvedValue(null);
    const result = await markNotificationRead(NOTIFICATION_ID);
    expect(result).toEqual({ ok: false, unreadCount: 0 });
    expect(db.from).not.toHaveBeenCalled();
  });

  it("invalid uuid returns {ok:false} without DB call", async () => {
    getUserMock.mockResolvedValue(USER);
    const result = await markNotificationRead("not-a-uuid");
    expect(result.ok).toBe(false);
    // The action falls through to getUnreadCount() but does NOT call the DB update
    expect(db.update).not.toHaveBeenCalled();
  });

  it("success path: updates ONLY the read column and is scoped to notification id via RLS", async () => {
    getUserMock.mockResolvedValue(USER);
    // The direct-await chain: update({ read: true }).eq("id", notifId)
    dbFn.mockResolvedValueOnce({ error: null });
    getUnreadCountMock.mockResolvedValue(3);

    const result = await markNotificationRead(NOTIFICATION_ID);

    expect(result).toEqual({ ok: true, unreadCount: 3 });
    // Assert only { read: true } is in the update (no extra columns)
    expect(db.update).toHaveBeenCalledWith({ read: true });
    expect(db.update.mock.calls[0][0]).toEqual({ read: true });
    // Assert eq was called with the notification id
    const eqCalls = db.eq.mock.calls as [string, string][];
    expect(eqCalls.some(([col, val]) => col === "id" && val === NOTIFICATION_ID)).toBe(true);
  });

  it("DB error causes ok:false but still returns unreadCount", async () => {
    getUserMock.mockResolvedValue(USER);
    dbFn.mockResolvedValueOnce({ error: { message: "oops" } });
    getUnreadCountMock.mockResolvedValue(7);

    const result = await markNotificationRead(NOTIFICATION_ID);

    expect(result.ok).toBe(false);
    expect(result.unreadCount).toBe(7);
  });
});

// ==========================================================================
// createNotification (from create.ts)
// ==========================================================================

describe("createNotification", () => {
  it("invalid input (bad userId) returns false without inserting", async () => {
    const result = await createNotification({
      userId: "not-a-uuid",
      type: "team",
      title: "Hello",
    });

    expect(result).toBe(false);
    expect(adminDb.insert).not.toHaveBeenCalled();
  });

  it("missing title returns false without inserting", async () => {
    const result = await createNotification({
      userId: USER_ID,
      type: "team",
      title: "", // empty - will fail the min(1) check
    });

    expect(result).toBe(false);
    expect(adminDb.insert).not.toHaveBeenCalled();
  });

  it("unknown type returns false without inserting", async () => {
    const result = await createNotification({
      userId: USER_ID,
      type: "unknown_type" as "team",
      title: "Test",
    });

    expect(result).toBe(false);
    expect(adminDb.insert).not.toHaveBeenCalled();
  });

  it("valid input inserts via ADMIN client and returns true", async () => {
    adminDbFn.mockResolvedValueOnce({ error: null });

    const result = await createNotification({
      userId: USER_ID,
      type: "team",
      title: "You have a team invite",
      body: "Welcome to the team.",
    });

    expect(result).toBe(true);
    expect(adminDb.insert).toHaveBeenCalledTimes(1);
    const insertPayload = adminDb.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertPayload.user_id).toBe(USER_ID);
    expect(insertPayload.type).toBe("team");
    expect(insertPayload.title).toBe("You have a team invite");
  });

  it("DB insert error returns false (never throws)", async () => {
    adminDbFn.mockResolvedValueOnce({ error: { message: "DB error" } });

    const result = await createNotification({
      userId: USER_ID,
      type: "system",
      title: "System notification",
    });

    expect(result).toBe(false);
  });

  it("never throws even when admin client throws", async () => {
    adminDbFn.mockRejectedValueOnce(new Error("unexpected"));

    await expect(
      createNotification({ userId: USER_ID, type: "system", title: "Test" }),
    ).resolves.toBe(false);
  });
});

// ==========================================================================
// getRealtimeToken
// ==========================================================================

describe("getRealtimeToken", () => {
  it("returns null when signed out", async () => {
    getUserMock.mockResolvedValue(null);
    const result = await getRealtimeToken();
    expect(result).toBeNull();
  });

  it("returns null when session has no access_token", async () => {
    getUserMock.mockResolvedValue(USER);
    db.auth.getSession.mockResolvedValue({ data: { session: null } });

    const result = await getRealtimeToken();

    expect(result).toBeNull();
  });

  it("returns session access_token when signed in", async () => {
    getUserMock.mockResolvedValue(USER);
    db.auth.getSession.mockResolvedValue({
      data: { session: { access_token: "jwt-abc-123" } },
    });

    const result = await getRealtimeToken();

    expect(result).toBe("jwt-abc-123");
  });
});
