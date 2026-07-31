// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks ---------------------------------------------------------------

const getUserMock = vi.fn();
const getProfileMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUserMock(),
  getProfile: () => getProfileMock(),
}));

const getActorRoleMock = vi.fn();
vi.mock("@/lib/team/queries", () => ({
  getActorRole: (accountId: string) => getActorRoleMock(accountId),
}));

// Include ACTIVE_ACCOUNT_COOKIE so setActiveAccount's import resolves correctly
vi.mock("@/lib/team/account-context", () => ({
  ACTIVE_ACCOUNT_COOKIE: "ss_active_account",
  getActiveAccount: vi.fn(),
  getAccessibleAccounts: vi.fn(),
}));

const resolveUserIdByEmailMock = vi.fn();
const createNotificationMock = vi.fn();
vi.mock("@/lib/notifications/create", () => ({
  resolveUserIdByEmail: (email: string) => resolveUserIdByEmailMock(email),
  createNotification: (...args: unknown[]) => createNotificationMock(...args),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Invites are rate limited; the real limiter hits Postgres and fails closed.
// Stubbed permissive by default, flipped in the throttling test below.
const rateLimitMock = vi.fn(async () => true);
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...real, rateLimit: () => rateLimitMock() };
});

const cookiesSetMock = vi.fn();
const cookiesMockFn = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => cookiesMockFn(),
}));

// Chainable fake Supabase client
const dbFn = vi.fn();
const db: any = {};
for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
  db[m] = vi.fn(() => db);
}
db.single = vi.fn(() => dbFn());
db.maybeSingle = vi.fn(() => dbFn());
db.rpc = vi.fn(() => dbFn());
// Thenable for direct-await patterns (e.g. supabase.from(...).insert({...}))
db.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
  Promise.resolve(dbFn()).then(resolve, reject);

// Non-thenable wrapper: prevents async () => db from unwrapping db via the
// thenable protocol. rpc is delegated so supabase.rpc() works in acceptInvite.
const clientWrapper = {
  from: (...args: unknown[]) => (db.from as (...a: unknown[]) => unknown)(...args),
  rpc: (...args: unknown[]) => (db.rpc as (...a: unknown[]) => unknown)(...args),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => clientWrapper,
}));

// ---- imports -------------------------------------------------------------

import {
  inviteMember,
  acceptInvite,
  changeMemberRole,
  revokeMemberAccess,
  setActiveAccount,
} from "@/lib/team/actions";

// ---- test constants ------------------------------------------------------

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const EDITOR_ID = "20000000-0000-4000-8000-000000000002";
const MEMBER_ID = "50000000-0000-4000-8000-000000000005";
const INVITE_ID = "40000000-0000-4000-8000-000000000004";

const OWNER_USER = { id: OWNER_ID, email: "owner@example.com" };
const EDITOR_USER = { id: EDITOR_ID, email: "editor@example.com" };

const PREV: { error?: string; success?: string } = {};

function makeInviteForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("account_owner_id", OWNER_ID);
  fd.append("invited_email", "new@example.com");
  fd.append("role", "viewer");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

function makeAcceptForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("invite_id", INVITE_ID);
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

function makeChangeRoleForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("account_owner_id", OWNER_ID);
  fd.append("member_id", MEMBER_ID);
  fd.append("role", "editor");
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

function makeRevokeForm(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.append("account_owner_id", OWNER_ID);
  fd.append("member_id", MEMBER_ID);
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbFn.mockResolvedValue({ data: null, error: null });
  for (const m of ["from", "select", "insert", "update", "delete", "eq", "neq", "in"]) {
    db[m].mockReturnValue(db);
  }
  db.single.mockImplementation(() => dbFn());
  db.maybeSingle.mockImplementation(() => dbFn());
  db.rpc.mockImplementation(() => dbFn());
  resolveUserIdByEmailMock.mockResolvedValue(null);
  createNotificationMock.mockResolvedValue(false);
  getProfileMock.mockResolvedValue(null);
  cookiesMockFn.mockResolvedValue({ set: cookiesSetMock, get: vi.fn() });
  rateLimitMock.mockResolvedValue(true);
});

// ==========================================================================
// inviteMember
// ==========================================================================

describe("inviteMember - field whitelist", () => {
  it("unknown extra FormData field is rejected before any DB call", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    const fd = makeInviteForm();
    fd.append("is_seller", "true"); // injected unknown field

    const result = await inviteMember(PREV, fd);

    expect(result.error).toMatch(/is_seller/);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("inviteMember - auth / role gates", () => {
  it("signed out returns SIGNED_OUT error", async () => {
    getUserMock.mockResolvedValue(null);
    const result = await inviteMember(PREV, makeInviteForm());
    expect(result.error).toMatch(/session/i);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("viewer actor (getActorRole returns viewer) is denied permission to invite", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    getActorRoleMock.mockResolvedValue("viewer");

    const result = await inviteMember(PREV, makeInviteForm());

    expect(result.error).toMatch(/permission/i);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("throttled inviter is refused and no invite row is written", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    getActorRoleMock.mockResolvedValue("owner");
    rateLimitMock.mockResolvedValue(false);

    const result = await inviteMember(PREV, makeInviteForm());

    expect(result.error).toMatch(/invites/i);
    // Nothing is written and nobody is notified — the spam never lands.
    expect(db.insert).not.toHaveBeenCalled();
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("permission is checked before the rate limit, so a denied actor spends no budget", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    getActorRoleMock.mockResolvedValue("viewer");

    await inviteMember(PREV, makeInviteForm());

    // Otherwise a viewer hammering invites could exhaust the owner's budget.
    expect(rateLimitMock).not.toHaveBeenCalled();
  });

  it("editor actor can invite at the editor role (canGrant: editor <= editor)", async () => {
    getUserMock.mockResolvedValue(EDITOR_USER);
    getActorRoleMock.mockResolvedValue("editor");
    dbFn.mockResolvedValueOnce({ error: null }); // insert

    const result = await inviteMember(
      PREV,
      makeInviteForm({ role: "editor", invited_email: "someone-else@example.com" }),
    );

    expect(result.success).toBeTruthy();
    expect(db.insert).toHaveBeenCalled();
  });
});

describe("inviteMember - self-invite", () => {
  it("inviting your own email returns 'already here' error", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    getActorRoleMock.mockResolvedValue("owner");

    // invited_email matches owner's own email (same-case check, schema lowercases both)
    const fd = makeInviteForm({ invited_email: "owner@example.com" });
    const result = await inviteMember(PREV, fd);

    expect(result.error).toMatch(/already here/i);
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("inviteMember - schema rejection", () => {
  it("'owner' role in FormData is rejected by schema (not in ASSIGNABLE_ROLES)", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    const fd = makeInviteForm({ role: "owner" });
    const result = await inviteMember(PREV, fd);
    // Zod parse fails before the actor-role lookup
    expect(result.error).toBeTruthy();
    expect(getActorRoleMock).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// acceptInvite
// ==========================================================================

describe("acceptInvite - field whitelist", () => {
  it("unknown extra field is rejected", async () => {
    getUserMock.mockResolvedValue({ ...OWNER_USER, email: "invited@example.com" });
    const fd = makeAcceptForm();
    fd.append("account_owner_id", OWNER_ID); // unexpected field

    const result = await acceptInvite(PREV, fd);

    expect(result.error).toMatch(/account_owner_id/);
  });
});

describe("acceptInvite - RPC result", () => {
  it("RPC returning false returns a friendly error", async () => {
    getUserMock.mockResolvedValue({ id: EDITOR_ID, email: "editor@example.com" });
    // fetch invite row
    dbFn.mockResolvedValueOnce({
      data: {
        id: INVITE_ID,
        status: "invited",
        invited_email: "editor@example.com",
        account_owner_id: OWNER_ID,
      },
      error: null,
    });
    // RPC returns false (invite was revoked between fetch and accept)
    dbFn.mockResolvedValueOnce({ data: false, error: null });

    const result = await acceptInvite(PREV, makeAcceptForm());

    expect(result.error).toMatch(/could not accept/i);
  });

  it("signed out returns SIGNED_OUT error", async () => {
    getUserMock.mockResolvedValue(null);
    const result = await acceptInvite(PREV, makeAcceptForm());
    expect(result.error).toMatch(/session/i);
  });
});

// ==========================================================================
// changeMemberRole
// ==========================================================================

describe("changeMemberRole - field whitelist", () => {
  it("unknown extra field is rejected", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    const fd = makeChangeRoleForm();
    fd.append("is_seller", "true");

    const result = await changeMemberRole(PREV, fd);

    expect(result.error).toMatch(/is_seller/);
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("changeMemberRole - role gates", () => {
  it("actor without team.change_role permission (viewer) is denied", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    getActorRoleMock.mockResolvedValue("viewer");

    const result = await changeMemberRole(PREV, makeChangeRoleForm());

    expect(result.error).toMatch(/permission/i);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("owner actor can change role, update is called with new role", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    getActorRoleMock.mockResolvedValue("owner");
    dbFn.mockResolvedValueOnce({ data: { id: MEMBER_ID }, error: null });

    const result = await changeMemberRole(PREV, makeChangeRoleForm({ role: "viewer" }));

    expect(result.success).toBeTruthy();
    expect(db.update).toHaveBeenCalledWith({ role: "viewer" });
  });
});

// ==========================================================================
// revokeMemberAccess
// ==========================================================================

describe("revokeMemberAccess - field whitelist", () => {
  it("unknown extra field is rejected", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    const fd = makeRevokeForm();
    fd.append("extra_field", "oops");

    const result = await revokeMemberAccess(PREV, fd);

    expect(result.error).toMatch(/extra_field/);
  });
});

describe("revokeMemberAccess - self-removal guard", () => {
  it("actor cannot remove themselves", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    getActorRoleMock.mockResolvedValue("owner");
    // Target row: member_user_id === current user id (self)
    dbFn.mockResolvedValueOnce({
      data: { id: MEMBER_ID, member_user_id: OWNER_ID },
      error: null,
    });

    const result = await revokeMemberAccess(PREV, makeRevokeForm());

    expect(result.error).toMatch(/yourself/i);
    // The second update should never be called
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("revokeMemberAccess - owner row protection", () => {
  it("uses .neq('role', 'owner') guard in the update query", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    getActorRoleMock.mockResolvedValue("owner");
    // Target row: someone else (not self)
    dbFn.mockResolvedValueOnce({
      data: { id: MEMBER_ID, member_user_id: EDITOR_ID },
      error: null,
    });
    // Update returns null (simulates the neq("role","owner") filtering out the row)
    dbFn.mockResolvedValueOnce({ data: null, error: null });

    const result = await revokeMemberAccess(PREV, makeRevokeForm());

    // The neq guard must be present in the chain
    const neqCalls = db.neq.mock.calls as [string, string][];
    expect(neqCalls.some(([col, val]) => col === "role" && val === "owner")).toBe(true);
    // And the action surfaces a friendly error when 0 rows updated
    expect(result.error).toMatch(/can't be removed/i);
  });

  it("permission denied when actor is a viewer", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    getActorRoleMock.mockResolvedValue("viewer");

    const result = await revokeMemberAccess(PREV, makeRevokeForm());

    expect(result.error).toMatch(/permission/i);
    expect(db.from).not.toHaveBeenCalled();
  });
});

// ==========================================================================
// setActiveAccount
// ==========================================================================

describe("setActiveAccount", () => {
  it("signed out returns {ok:false} and cookie is not set", async () => {
    getUserMock.mockResolvedValue(null);
    const result = await setActiveAccount(OWNER_ID);
    expect(result).toEqual({ ok: false });
    expect(cookiesSetMock).not.toHaveBeenCalled();
  });

  it("non-UUID accountId returns {ok:false}", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    const result = await setActiveAccount("not-a-uuid");
    expect(result).toEqual({ ok: false });
    expect(cookiesSetMock).not.toHaveBeenCalled();
  });

  it("switching to own accountId sets cookie without getActorRole check", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);

    const result = await setActiveAccount(OWNER_ID);

    expect(result).toEqual({ ok: true });
    expect(getActorRoleMock).not.toHaveBeenCalled();
    expect(cookiesSetMock).toHaveBeenCalledWith(
      "ss_active_account",
      OWNER_ID,
      expect.any(Object),
    );
  });

  it("switching to another store: member → cookie set, ok:true", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    getActorRoleMock.mockResolvedValue("editor");

    const result = await setActiveAccount(EDITOR_ID);

    expect(result).toEqual({ ok: true });
    expect(getActorRoleMock).toHaveBeenCalledWith(EDITOR_ID);
    expect(cookiesSetMock).toHaveBeenCalledWith(
      "ss_active_account",
      EDITOR_ID,
      expect.any(Object),
    );
  });

  it("switching to another store: non-member → {ok:false}, cookie NOT set", async () => {
    getUserMock.mockResolvedValue(OWNER_USER);
    getActorRoleMock.mockResolvedValue(null); // not a member

    const result = await setActiveAccount(EDITOR_ID);

    expect(result).toEqual({ ok: false });
    expect(cookiesSetMock).not.toHaveBeenCalled();
  });
});
