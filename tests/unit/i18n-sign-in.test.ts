// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localeForSignedInBrowser } from "@/i18n/sign-in";

/** Just enough of the Supabase query builder for the two calls the sync makes. */
function fakeClient(profile: { locale: string | null } | null, opts: { readError?: boolean } = {}) {
  const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
  const client = {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          maybeSingle: vi.fn().mockResolvedValue(
            opts.readError
              ? { data: null, error: { code: "PGRST000" } }
              : { data: profile, error: null },
          ),
        }),
      }),
      update,
    })),
  };
  return { client: client as never, update };
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("localeForSignedInBrowser", () => {
  it("a new browser takes the account's saved language", async () => {
    const { client, update } = fakeClient({ locale: "cs" });
    expect(await localeForSignedInBrowser(client, "u1", undefined)).toBe("cs");
    expect(update).not.toHaveBeenCalled();
  });

  it("a browser that already chose keeps it, and the account learns it", async () => {
    const { client, update } = fakeClient({ locale: "en" });
    expect(await localeForSignedInBrowser(client, "u1", "de")).toBeNull();
    expect(update).toHaveBeenCalledWith({ locale: "de" });
  });

  it("does not rewrite the account when the two already agree", async () => {
    const { client, update } = fakeClient({ locale: "de" });
    expect(await localeForSignedInBrowser(client, "u1", "de")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("ignores a tampered cookie and an unsupported saved value", async () => {
    const { client, update } = fakeClient({ locale: "xx" });
    expect(await localeForSignedInBrowser(client, "u1", "../../etc")).toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("never fails the sign-in it runs inside", async () => {
    const { client } = fakeClient(null, { readError: true });
    expect(await localeForSignedInBrowser(client, "u1", undefined)).toBeNull();

    const broken = { from: () => { throw new Error("boom"); } } as never;
    await expect(localeForSignedInBrowser(broken, "u1", "cs")).resolves.toBeNull();
  });
});
