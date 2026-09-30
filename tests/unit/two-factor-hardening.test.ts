// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The pure parts of the 2FA hardening (security sweep of 2026-09-30):
 * who gets sign-in approval by default, the numbers the approving phone picks
 * from, how the account's factors are classified against the app's own
 * records, and the breached-password check's k-anonymity and fail-open rules.
 */

const records = vi.hoisted(() => ({
  passkeys: [] as { factor_id: string }[],
  approval: null as { factor_id: string } | null,
  fail: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => {
          const error = records.fail ? { message: "down" } : null;
          if (table === "mfa_passkeys") {
            return Promise.resolve({ data: records.fail ? null : records.passkeys, error });
          }
          return {
            maybeSingle: () => Promise.resolve({ data: records.fail ? null : records.approval, error }),
          };
        },
      }),
    }),
  }),
}));

import { approvalsOnByDefault, matchChoices } from "@/lib/auth/sign-in-approval";
import { accountFactors, realFactors } from "@/lib/auth/account-factors";
import { passwordIsBreached } from "@/lib/auth/breached-password";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  records.passkeys = [];
  records.approval = null;
  records.fail = false;
});

const app = { id: "a", name: "Phone", type: "totp" as const, createdAt: "2026-09-01T00:00:00Z" };
const passkey = { ...app, id: "p", name: "Laptop", type: "passkey" as const };

describe("approvalsOnByDefault", () => {
  it("is on for an account with an authenticator app", () => {
    expect(approvalsOnByDefault({ factors: [app], approvalFactorId: null })).toBe(true);
    expect(approvalsOnByDefault({ factors: [passkey, app], approvalFactorId: null })).toBe(true);
  });

  it("is off for a passkey-only account that has never approved a sign-in", () => {
    expect(approvalsOnByDefault({ factors: [passkey], approvalFactorId: null })).toBe(false);
  });

  it("stays on for an account already using it", () => {
    expect(approvalsOnByDefault({ factors: [passkey], approvalFactorId: "x" })).toBe(true);
  });
});

describe("matchChoices", () => {
  it("offers three different two-digit numbers, one of them the right one", () => {
    for (let run = 0; run < 200; run += 1) {
      const code = 10 + (run % 90);
      const choices = matchChoices(code);
      expect(choices).toHaveLength(3);
      expect(new Set(choices).size).toBe(3);
      expect(choices).toContain(code);
      for (const choice of choices) {
        expect(choice).toBeGreaterThanOrEqual(10);
        expect(choice).toBeLessThanOrEqual(99);
      }
    }
  });

  it("does not always put the right number in the same place", () => {
    const places = new Set<number>();
    for (let run = 0; run < 200; run += 1) places.add(matchChoices(42).indexOf(42));
    expect(places).toEqual(new Set([0, 1, 2]));
  });
});

const factor = (id: string, friendly_name: string, extra: Record<string, unknown> = {}) => ({
  id,
  friendly_name,
  factor_type: "totp",
  status: "verified",
  created_at: `2026-09-0${id.length}T00:00:00Z`,
  updated_at: "2026-09-01T00:00:00Z",
  ...extra,
});

describe("accountFactors", () => {
  it("names each factor by the app's own records, not by its name alone", async () => {
    records.passkeys = [{ factor_id: "pk" }];
    records.approval = { factor_id: "ap" };
    const list = await accountFactors({
      id: "u",
      factors: [
        factor("a", "Phone"),
        factor("pk", "passkey:Laptop"),
        factor("ap", "approval:signed-in-devices"),
        // Reserved names with nothing behind them: made around the app.
        factor("fake", "passkey:Mine now"),
        factor("fake2", "approval:hidden"),
        // A type the app never makes.
        factor("ph", "Phone number", { factor_type: "phone" }),
        // Not switched on: not a way in, so not listed.
        factor("u1", "Pending", { status: "unverified" }),
      ] as never,
    });
    expect(list?.map(({ id, kind }) => [id, kind])).toEqual([
      ["a", "app"],
      ["pk", "passkey"],
      ["ap", "approval"],
      ["ph", "unknown"],
      ["fake", "unknown"],
      ["fake2", "unknown"],
    ]);
    expect(list?.find((f) => f.id === "pk")?.name).toBe("Laptop");
    expect(list?.find((f) => f.id === "fake2")?.name).toBe("approval:hidden");
    expect(realFactors(list ?? []).map((f) => f.id)).toEqual(["a", "pk"]);
  });

  it("says it doesn't know rather than guessing when the records can't be read", async () => {
    records.fail = true;
    expect(await accountFactors({ id: "u", factors: [factor("a", "Phone")] as never })).toBeNull();
  });
});

describe("passwordIsBreached", () => {
  // SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
  const PREFIX = "5BAA6";
  const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

  it("sends only the first five characters of the hash, and matches the rest here", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(`0018A45C4D1DEF81644B54AB7F969B88D65:3\r\n${SUFFIX}:9545824\r\n`));
    vi.stubGlobal("fetch", fetchMock);
    expect(await passwordIsBreached("password")).toBe(true);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.endsWith(`/range/${PREFIX}`)).toBe(true);
    expect(url).not.toContain(SUFFIX);
  });

  it("does not count a padding row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(`${SUFFIX}:0\r\n`)));
    expect(await passwordIsBreached("password")).toBe(false);
  });

  it("lets the password through when the service fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    expect(await passwordIsBreached("password")).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    expect(await passwordIsBreached("password")).toBe(false);
  });
});
