// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getUser: () => getUser() }));

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
}));

import { GET } from "@/app/api/settings/display-name-available/route";

function request(name?: string): Request {
  const url = new URL("http://localhost/api/settings/display-name-available");
  if (name !== undefined) url.searchParams.set("name", name);
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/settings/display-name-available", () => {
  it("401 when signed out — no unauthenticated name enumeration", async () => {
    getUser.mockResolvedValue(null);
    const res = await GET(request("someone"));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("400 for a missing, empty, or oversized name", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    for (const name of [undefined, "", "   ", "x".repeat(51)]) {
      const res = await GET(request(name));
      expect(res.status, String(name)).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("delegates to the SECURITY DEFINER rpc and passes the answer through", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await GET(request("taken-name"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
    expect(rpc).toHaveBeenCalledWith("is_display_name_available", {
      p_display_name: "taken-name",
    });
  });

  it("trims the name before the lookup (schema trim)", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    rpc.mockResolvedValue({ data: true, error: null });
    await GET(request("  padded  "));
    expect(rpc).toHaveBeenCalledWith("is_display_name_available", {
      p_display_name: "padded",
    });
  });

  it("500 without leaking DB details when the rpc errors", async () => {
    getUser.mockResolvedValue({ id: "u1" });
    rpc.mockResolvedValue({ data: null, error: { message: "secret db detail" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(request("name"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toContain("secret db detail");
    spy.mockRestore();
  });
});
