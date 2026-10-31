// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";

/**
 * THE SEAM. Everything an assistant can do rests on these few branches, and a
 * browser request must never take one. Each test here runs both sides.
 */

const cookieGet = vi.fn();
const cookies = vi.fn(async () => ({ get: cookieGet, getAll: () => [], set: vi.fn() }));
const getActorRole = vi.fn();
const rpc = vi.fn(async () => ({ data: true, error: null }));
const createServerClient = vi.fn(() => ({ rpc, auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) } }));

vi.mock("next/headers", () => ({ cookies, headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient }));
vi.mock("@/lib/team/queries", () => ({ getActorRole }));

const { runAsAgent, agentContext } = await import("@/lib/agent/context");
const { createClient } = await import("@/lib/supabase/server");
const { getActiveAccount } = await import("@/lib/team/account-context");
const { getUser, getSessionState } = await import("@/lib/auth/session");
const { rateLimit } = await import("@/lib/rate-limit");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_STORE = "22222222-2222-4222-8222-222222222222";

function agent(accountId = USER_ID) {
  return {
    user: { id: USER_ID, email: "seller@example.com" } as User,
    accountId,
    grantId: "grant-1",
    clientId: "client-1",
    scopes: new Set(["store:read" as const]),
    jwt: "minted.jwt.value",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
});

describe("a browser request", () => {
  it("is not an agent", () => {
    expect(agentContext()).toBeNull();
  });

  it("reads its session from cookies, with no Authorization header set", async () => {
    await createClient();
    expect(cookies).toHaveBeenCalled();
    const options = createServerClient.mock.calls[0]?.[2 as never] as { global: { headers?: unknown } };
    expect(options.global.headers).toBeUndefined();
  });

  it("spends the ordinary budget", async () => {
    await rateLimit("product_write", { max: 1, windowSeconds: 1 });
    expect(rpc).toHaveBeenCalledWith("rl_take", expect.objectContaining({ p_action: "product_write" }));
  });
});

describe("an assistant's request", () => {
  it("never touches the cookie jar, and sends its minted JWT", async () => {
    await runAsAgent(agent(), () => createClient());
    expect(cookies).not.toHaveBeenCalled();
    const options = createServerClient.mock.calls[0]?.[2 as never] as {
      global: { headers: { Authorization: string } };
    };
    expect(options.global.headers.Authorization).toBe("Bearer minted.jwt.value");
  });

  it("is signed in as the person who approved it, without asking GoTrue", async () => {
    const user = await runAsAgent(agent(), () => getUser());
    expect(user?.id).toBe(USER_ID);
    const state = await runAsAgent(agent(), () => getSessionState());
    expect(state.kind).toBe("signed_in");
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("acts on its own store as owner", async () => {
    const account = await runAsAgent(agent(), () => getActiveAccount());
    expect(account).toEqual({ accountId: USER_ID, role: "owner", isOwner: true, userId: USER_ID });
    expect(cookieGet).not.toHaveBeenCalled();
  });

  it("acts on a team store with the role the database gives it NOW", async () => {
    getActorRole.mockResolvedValueOnce("editor");
    const account = await runAsAgent(agent(OTHER_STORE), () => getActiveAccount());
    expect(getActorRole).toHaveBeenCalledWith(OTHER_STORE);
    expect(account).toEqual({ accountId: OTHER_STORE, role: "editor", isOwner: false, userId: USER_ID });
  });

  it("gets NOTHING once removed from that store, never its own store instead", async () => {
    getActorRole.mockResolvedValueOnce(null);
    const account = await runAsAgent(agent(OTHER_STORE), () => getActiveAccount());
    expect(account).toBeNull();
  });

  it("ignores the store-switching cookie entirely", async () => {
    cookieGet.mockReturnValue({ value: OTHER_STORE });
    const account = await runAsAgent(agent(), () => getActiveAccount());
    expect(account?.accountId).toBe(USER_ID);
    expect(getActorRole).not.toHaveBeenCalled();
  });

  it("spends a budget of its own, so a loop cannot lock the person out", async () => {
    await runAsAgent(agent(), () => rateLimit("product_write", { max: 1, windowSeconds: 1 }));
    expect(rpc).toHaveBeenCalledWith("rl_take", expect.objectContaining({ p_action: "agent:product_write" }));
  });

  it("stays the agent across awaits, and is gone afterwards", async () => {
    await runAsAgent(agent(), async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(agentContext()?.grantId).toBe("grant-1");
    });
    expect(agentContext()).toBeNull();
  });
});

describe("step-up", () => {
  it("is always refused for an assistant, whatever the account's 2FA state", async () => {
    const { requireStepUpState } = await import("@/lib/auth/mfa");
    const state = await runAsAgent(agent(), () => requireStepUpState(new FormData()));
    // An account without 2FA passes a browser's step-up untouched. An agent's
    // assurance reads as exactly that, so this is the line that matters.
    expect(state).not.toBeNull();
    expect(state?.error?.code).toBe("session_expired");
  });
});
