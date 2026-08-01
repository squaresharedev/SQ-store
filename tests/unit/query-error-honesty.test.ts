// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ERROR-HONESTY INVARIANTS for page-level reads.
 *
 * These queries used to swallow DB errors into empty data, so a failed read
 * rendered as the calm empty state: an orders table saying "no orders yet", a
 * dashboard saying "€0.00 all-time", a roster saying "just you". A user cannot
 * tell that lie apart from reality, and error.tsx (which offers a retry) never
 * fires. The fix made them THROW; these tests pin that so a future "defensive"
 * catch does not quietly reintroduce the swallow.
 *
 * getActorRole stays null-on-error BY DESIGN: it is an authorization probe,
 * and "no permission" is the correct fail-closed answer when the check cannot
 * run. That contract is pinned here too.
 */

// ---- mocks ---------------------------------------------------------------

const getActiveAccountMock = vi.fn();
vi.mock("@/lib/team/account-context", () => ({
  getActiveAccount: () => getActiveAccountMock(),
}));

const getUserMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUserMock(),
}));

/** Staged response per table/rpc name; every chain resolves to its entry. */
const responses = new Map<string, { data: unknown; error: unknown; count?: number }>();

function makeChain(name: string): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "lt", "order", "range", "limit"]) {
    chain[method] = () => chain;
  }
  chain.then = (
    resolve: (value: unknown) => void,
    reject?: (reason: unknown) => void,
  ) => {
    const next = responses.get(name) ?? { data: [], error: null, count: 0 };
    return Promise.resolve(next).then(resolve, reject);
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => makeChain(table),
    rpc: (fn: string) => makeChain(`rpc:${fn}`),
  }),
}));

// ---- imports -------------------------------------------------------------

import { listOrders } from "@/lib/orders/queries";
import { getDashboardOrders } from "@/lib/dashboard/queries";
import { getAnalytics } from "@/lib/analytics/queries";
import { getTeamRoster, getMyPendingInvites, getActorRole } from "@/lib/team/queries";
import { getNotificationPage } from "@/lib/notifications/queries";

const ACCOUNT = {
  accountId: "11111111-1111-4111-8111-111111111111",
  userId: "11111111-1111-4111-8111-111111111111",
  isOwner: true,
  role: "owner",
};
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "me@x.test" };
const DB_ERROR = { message: "connection refused" };

beforeEach(() => {
  vi.clearAllMocks();
  responses.clear();
  getActiveAccountMock.mockResolvedValue(ACCOUNT);
  getUserMock.mockResolvedValue(USER);
});

describe("page reads throw on DB error instead of faking emptiness", () => {
  it("listOrders", async () => {
    responses.set("orders", { data: null, error: DB_ERROR });
    await expect(listOrders()).rejects.toThrow(/unavailable/i);
  });

  it("getDashboardOrders", async () => {
    responses.set("orders", { data: null, error: DB_ERROR });
    await expect(getDashboardOrders()).rejects.toThrow(/unavailable/i);
  });

  it("getAnalytics", async () => {
    responses.set("orders", { data: null, error: DB_ERROR });
    await expect(getAnalytics({ preset: "all", from: null, to: null } as never)).rejects.toThrow(
      /unavailable/i,
    );
  });

  it("getTeamRoster", async () => {
    responses.set("rpc:team_roster", { data: null, error: DB_ERROR });
    await expect(getTeamRoster(ACCOUNT.accountId)).rejects.toThrow(/unavailable/i);
  });

  it("getMyPendingInvites", async () => {
    responses.set("rpc:team_my_pending_invites", { data: null, error: DB_ERROR });
    await expect(getMyPendingInvites()).rejects.toThrow(/unavailable/i);
  });

  it("getNotificationPage", async () => {
    responses.set("notifications", { data: null, error: DB_ERROR });
    await expect(getNotificationPage()).rejects.toThrow(/unavailable/i);
  });
});

describe("deliberate soft-fail contracts stay soft", () => {
  it("getActorRole fails CLOSED to null (authorization probe, not a page read)", async () => {
    responses.set("rpc:team_actor_role", { data: null, error: DB_ERROR });
    await expect(getActorRole(ACCOUNT.accountId)).resolves.toBeNull();
  });

  it("signed-out callers still get calm empty values, not errors", async () => {
    getActiveAccountMock.mockResolvedValue(null);
    getUserMock.mockResolvedValue(null);
    // No staged errors: these paths return before touching the DB.
    await expect(getDashboardOrders()).resolves.toBeTruthy();
    await expect(getAnalytics({ preset: "all", from: null, to: null } as never)).resolves.toBeTruthy();
    await expect(getNotificationPage()).resolves.toEqual({
      notifications: [],
      nextCursor: null,
    });
  });
});
