// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks ---------------------------------------------------------------

const getUserMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUserMock(),
  getProfile: vi.fn(),
}));

const acceptMock = vi.fn();
vi.mock("@/lib/team/accept", () => ({
  acceptTeamInvite: (inviteId: string) => acceptMock(inviteId),
}));

/** What the fake database answers. */
const db = {
  row: null as unknown,
  pending: [] as unknown[],
  accounts: [] as unknown[],
  rpcError: null as null | { message: string },
};
/** Every `.eq()` and `.update()` the code under test made, in order. */
const calls = { eq: [] as [string, unknown][], update: [] as unknown[], rpc: [] as string[] };

function query() {
  const q: Record<string, unknown> = {};
  q.select = vi.fn(() => q);
  q.eq = vi.fn((column: string, value: unknown) => {
    calls.eq.push([column, value]);
    return q;
  });
  q.update = vi.fn((values: unknown) => {
    calls.update.push(values);
    return q;
  });
  q.maybeSingle = vi.fn(async () => ({ data: db.row, error: null }));
  q.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve({ error: null }).then(resolve, reject);
  return q;
}

const client = {
  from: vi.fn(() => query()),
  rpc: vi.fn(async (name: string) => {
    calls.rpc.push(name);
    if (name === "team_my_pending_invites") return { data: db.pending, error: db.rpcError };
    if (name === "team_my_accounts") return { data: db.accounts, error: db.rpcError };
    return { data: null, error: null };
  }),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => client,
}));

// ---- imports -------------------------------------------------------------

import { runNotificationAction } from "@/lib/notifications/actions";
import { withResolvedActions } from "@/lib/notifications/resolve-actions";
import type { Notification } from "@/lib/notifications/types";

// ---- fixtures ------------------------------------------------------------

const USER = { id: "10000000-0000-4000-8000-00000000000a", email: "me@example.com" };
const OWNER = "20000000-0000-4000-8000-000000000002";
const OTHER_OWNER = "30000000-0000-4000-8000-000000000003";
const INVITE = "40000000-0000-4000-8000-000000000004";
const OTHER_INVITE = "50000000-0000-4000-8000-000000000005";
const NOTIFICATION = "70000000-0000-4000-8000-000000000007";

const storedInvite = {
  href: "/settings/team",
  action: { kind: "team.acceptInvite", inviteId: INVITE, accountOwnerId: OWNER },
};

const legacyInvite = {
  href: "/settings/team",
  message: {
    title: { key: "Notifications.messages.teamInvite.title" },
    body: { key: "Notifications.messages.teamInvite.body", values: { store: "builderboy", role: "viewer" } },
  },
};

function pendingInvite(id: string, owner: string, store = "builderboy", role = "viewer") {
  return { id, account_owner_id: owner, role, invited_at: "2026-09-01T00:00:00Z", store_name: store };
}

function membership(owner: string, store = "builderboy") {
  return { account_owner_id: owner, role: "viewer", store_name: store, is_self: false };
}

function row(data: unknown, overrides: Partial<Notification> = {}): Notification {
  return {
    id: NOTIFICATION,
    user_id: USER.id,
    type: "team",
    title: "You have a team invite",
    body: null,
    read: false,
    created_at: "2026-09-01T00:00:00Z",
    data,
    ...overrides,
  } as Notification;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockResolvedValue(USER);
  db.row = null;
  db.pending = [];
  db.accounts = [];
  db.rpcError = null;
  calls.eq = [];
  calls.update = [];
  calls.rpc = [];
  acceptMock.mockResolvedValue({ ok: true, accountOwnerId: OWNER });
});

// ==========================================================================
// runNotificationAction
// ==========================================================================

describe("runNotificationAction", () => {
  it("signed out: refuses before reading anything", async () => {
    getUserMock.mockResolvedValue(null);
    const result = await runNotificationAction(NOTIFICATION);
    expect(result.ok).toBe(false);
    expect(client.from).not.toHaveBeenCalled();
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it("a malformed id is refused without a query", async () => {
    const result = await runNotificationAction("not-a-uuid");
    expect(result).toMatchObject({ ok: false, status: "expired" });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("reads the row as the CALLER's own, and does nothing for someone else's", async () => {
    db.row = null; // RLS + the owner predicate: another user's row reads as missing
    const result = await runNotificationAction(NOTIFICATION);
    expect(calls.eq).toContainEqual(["id", NOTIFICATION]);
    expect(calls.eq).toContainEqual(["user_id", USER.id]);
    expect(result).toMatchObject({ ok: false, status: "expired" });
    expect(acceptMock).not.toHaveBeenCalled();
  });

  it("accepts the invite named by the stored row, then marks the row read", async () => {
    db.row = row(storedInvite);
    db.pending = [pendingInvite(INVITE, OWNER)];

    const result = await runNotificationAction(NOTIFICATION);

    expect(acceptMock).toHaveBeenCalledWith(INVITE);
    expect(result).toMatchObject({ ok: true, accountOwnerId: OWNER });
    expect(calls.update).toEqual([{ read: true }]);
  });

  it("does not accept an invite the reader no longer has pending", async () => {
    // The row names INVITE, but only a different invite is pending: the row
    // must not be able to point the accept at anything but its own invite.
    db.row = row(storedInvite);
    db.pending = [pendingInvite(OTHER_INVITE, OTHER_OWNER)];

    const result = await runNotificationAction(NOTIFICATION);

    expect(acceptMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, status: "expired" });
  });

  it("is idempotent: an invite already accepted elsewhere comes back as done", async () => {
    db.row = row(storedInvite);
    db.accounts = [membership(OWNER)];

    const result = await runNotificationAction(NOTIFICATION);

    expect(acceptMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, accountOwnerId: OWNER });
  });

  it("losing a race to another tab still ends as done", async () => {
    db.row = row(storedInvite);
    db.pending = [pendingInvite(INVITE, OWNER)];
    acceptMock.mockImplementation(async () => {
      db.accounts = [membership(OWNER)]; // the other tab got there first
      return {
        ok: false,
        error: { code: "invalid_input", message: { key: "Errors.team.inviteUsed" } },
        accountOwnerId: OWNER,
      };
    });

    const result = await runNotificationAction(NOTIFICATION);

    expect(result).toMatchObject({ ok: true, accountOwnerId: OWNER });
  });

  it("a server failure is reported as retryable", async () => {
    db.row = row(storedInvite);
    db.pending = [pendingInvite(INVITE, OWNER)];
    acceptMock.mockResolvedValue({
      ok: false,
      error: { code: "server_error", message: { key: "Errors.team.acceptFailed" } },
      accountOwnerId: OWNER,
    });

    const result = await runNotificationAction(NOTIFICATION);

    expect(result).toMatchObject({ ok: false, status: "pending" });
    expect(calls.update).toEqual([]);
  });

  it("an older invite notification is matched to its one pending invite by store and role", async () => {
    db.row = row(legacyInvite);
    db.pending = [
      pendingInvite(INVITE, OWNER, "builderboy", "viewer"),
      pendingInvite(OTHER_INVITE, OTHER_OWNER, "someoneelse", "viewer"),
    ];

    const result = await runNotificationAction(NOTIFICATION);

    expect(acceptMock).toHaveBeenCalledWith(INVITE);
    expect(result.ok).toBe(true);
  });

  it("never guesses between two pending invites that both fit", async () => {
    db.row = row(legacyInvite);
    db.pending = [
      pendingInvite(INVITE, OWNER, "builderboy", "viewer"),
      pendingInvite(OTHER_INVITE, OTHER_OWNER, "builderboy", "viewer"),
    ];

    const result = await runNotificationAction(NOTIFICATION);

    expect(acceptMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: false, status: "expired" });
  });

  it("a notification that is not an invite has no action to run", async () => {
    db.row = row({ href: "/settings/account#password" }, { type: "security" });
    const result = await runNotificationAction(NOTIFICATION);
    expect(acceptMock).not.toHaveBeenCalled();
    expect(calls.rpc).toEqual([]);
    expect(result).toMatchObject({ ok: false, status: "expired" });
  });
});

// ==========================================================================
// withResolvedActions
// ==========================================================================

describe("withResolvedActions", () => {
  it("costs nothing when no row could carry an action", async () => {
    const rows = await withResolvedActions([
      row({ href: "/settings/account" }, { type: "security" }),
      row(null, { type: "system" }),
    ]);
    expect(rows.map((r) => r.action)).toEqual([null, null]);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("reads live invite state once for the whole page", async () => {
    db.pending = [pendingInvite(INVITE, OWNER)];
    await withResolvedActions([row(storedInvite), row(storedInvite), row(legacyInvite)]);
    expect(calls.rpc.sort()).toEqual(["team_my_accounts", "team_my_pending_invites"]);
  });

  it("pending, done and expired, against live state", async () => {
    const accepted = {
      action: { kind: "team.acceptInvite", inviteId: OTHER_INVITE, accountOwnerId: OTHER_OWNER },
    };
    const revoked = {
      action: {
        kind: "team.acceptInvite",
        inviteId: "60000000-0000-4000-8000-000000000006",
        accountOwnerId: "60000000-0000-4000-8000-000000000066",
      },
    };
    db.pending = [pendingInvite(INVITE, OWNER)];
    db.accounts = [membership(OTHER_OWNER, "otherstore")];

    const rows = await withResolvedActions([row(storedInvite), row(accepted), row(revoked)]);

    expect(rows.map((r) => r.action?.status)).toEqual(["pending", "done", "expired"]);
  });

  it("an older invite whose store the reader already joined reads as done", async () => {
    db.accounts = [membership(OWNER, "builderboy")];
    const [resolved] = await withResolvedActions([row(legacyInvite)]);
    expect(resolved.action).toEqual({ kind: "team.acceptInvite", status: "done" });
  });

  it("fails soft: a lookup error hides the button, never the row", async () => {
    db.rpcError = { message: "boom" };
    const rows = await withResolvedActions([row(storedInvite)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBeNull();
  });
});
