// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- mocks ---------------------------------------------------------------

const getUserMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getUser: () => getUserMock(),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

// Chainable fake Supabase query. The action awaits the chain directly
// (from().update().eq().is()), so the chain itself is thenable and resolves to
// whatever `dbResult` is primed with.
const dbResult = vi.fn();
const db: any = {};
for (const method of ["from", "update", "eq", "is"]) {
  db[method] = vi.fn(() => db);
}
db.then = (resolve: (value: unknown) => void, reject?: (reason: unknown) => void) =>
  Promise.resolve(dbResult()).then(resolve, reject);

// Non-thenable wrapper, so `await createClient()` does not unwrap the chain.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (...args: unknown[]) => db.from(...args),
  }),
}));

// ---- imports -------------------------------------------------------------

import { completeOnboarding, markSetupCelebrated } from "@/lib/onboarding/actions";

const USER_ID = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  dbResult.mockReturnValue({ error: null });
  for (const method of ["from", "update", "eq", "is"]) {
    db[method].mockReturnValue(db);
  }
});

describe("completeOnboarding", () => {
  it("does nothing for a signed-out caller", async () => {
    getUserMock.mockResolvedValue(null);

    await expect(completeOnboarding()).resolves.toEqual({ ok: false });

    expect(db.update).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("stamps the caller's own row, and only while it is still unset", async () => {
    getUserMock.mockResolvedValue({ id: USER_ID });

    await expect(completeOnboarding()).resolves.toEqual({ ok: true });

    expect(db.from).toHaveBeenCalledWith("profiles");
    const payload = db.update.mock.calls[0][0] as Record<string, unknown>;
    // One column and nothing else: this action must never become a way to
    // write any other profile field.
    expect(Object.keys(payload)).toEqual(["onboarding_completed_at"]);
    expect(Number.isNaN(Date.parse(String(payload.onboarding_completed_at)))).toBe(false);
    expect(db.eq).toHaveBeenCalledWith("id", USER_ID);
    // First write wins: a second tab or a replayed request matches no row.
    expect(db.is).toHaveBeenCalledWith("onboarding_completed_at", null);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it("reports a failed write instead of throwing into a dialog that is closing", async () => {
    getUserMock.mockResolvedValue({ id: USER_ID });
    dbResult.mockReturnValue({ error: { code: "42501", message: "denied" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(completeOnboarding()).resolves.toEqual({ ok: false });

    expect(revalidatePathMock).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("markSetupCelebrated", () => {
  it("does nothing for a signed-out caller", async () => {
    getUserMock.mockResolvedValue(null);

    await expect(markSetupCelebrated()).resolves.toEqual({ ok: false });

    expect(db.update).not.toHaveBeenCalled();
  });

  it("stamps the caller's own row once, and never revalidates the page it is shown on", async () => {
    getUserMock.mockResolvedValue({ id: USER_ID });

    await expect(markSetupCelebrated()).resolves.toEqual({ ok: true });

    expect(db.from).toHaveBeenCalledWith("profiles");
    const payload = db.update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["setup_celebrated_at"]);
    expect(Number.isNaN(Date.parse(String(payload.setup_celebrated_at)))).toBe(false);
    expect(db.eq).toHaveBeenCalledWith("id", USER_ID);
    expect(db.is).toHaveBeenCalledWith("setup_celebrated_at", null);
    // It runs while the card is on screen: a revalidate would re-render Overview
    // without it, and the card would vanish the moment it appeared.
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of throwing", async () => {
    getUserMock.mockResolvedValue({ id: USER_ID });
    dbResult.mockReturnValue({ error: { code: "42501", message: "denied" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(markSetupCelebrated()).resolves.toEqual({ ok: false });

    warn.mockRestore();
  });
});
