// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  RECENT_SIGN_IN_SECONDS,
  STEP_UP_WINDOW_SECONDS,
  assuranceFrom,
  decodeJwtPayload,
  hasVerifiedFactor,
  needsSecondFactor,
  secondFactorIsFresh,
  signedInRecently,
  stepUpFreshUntil,
  verifiedFactors,
} from "@/lib/auth/assurance";

/**
 * The rules every "is this session good enough?" decision rests on. Pure, so
 * they are pinned directly rather than through a mocked Supabase client.
 */

const b64url = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** An unsigned JWT-shaped token. The module never checks signatures (GoTrue
 *  already has), so the shape is all that matters here. */
function token(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
}

const NOW = 1_800_000_000;

const verified = (id: string, created: string, name = "Phone") => ({
  id,
  friendly_name: name,
  factor_type: "totp" as const,
  status: "verified" as const,
  created_at: created,
  updated_at: created,
});

describe("decodeJwtPayload", () => {
  it("reads the payload of a JWT", () => {
    expect(decodeJwtPayload(token({ aal: "aal2", sub: "u" }))).toEqual({ aal: "aal2", sub: "u" });
  });

  it("returns null for anything that is not a JWT", () => {
    for (const bad of [null, undefined, "", "abc", "a.b", "a.!!!.c", "a.b.c.d"]) {
      expect(decodeJwtPayload(bad), String(bad)).toBeNull();
    }
  });

  it("returns null for a payload that is JSON but not an object", () => {
    expect(decodeJwtPayload(`x.${b64url([1, 2])}.y`)).toBeNull();
    expect(decodeJwtPayload(`x.${b64url("aal2")}.y`)).toBeNull();
  });

  it("decodes UTF-8 claims intact", () => {
    expect(decodeJwtPayload(token({ name: "Zoë ✓" }))?.name).toBe("Zoë ✓");
  });
});

describe("verifiedFactors / hasVerifiedFactor", () => {
  it("keeps only verified TOTP factors, oldest first", () => {
    const factors = verifiedFactors({
      factors: [
        verified("b", "2026-09-02T00:00:00Z", "Second"),
        { ...verified("x", "2026-09-01T00:00:00Z"), status: "unverified" },
        verified("a", "2026-09-01T00:00:00Z", "First"),
      ],
    });
    expect(factors.map((f) => f.id)).toEqual(["a", "b"]);
    expect(factors[0].name).toBe("First");
  });

  it("names an unnamed factor rather than showing a blank", () => {
    const [factor] = verifiedFactors({
      factors: [{ ...verified("a", "2026-09-01T00:00:00Z"), friendly_name: "  " }],
    });
    expect(factor.name).toBe("Authenticator app 1");
  });

  it("treats ANY verified factor type as 2FA on, like GoTrue does", () => {
    expect(
      hasVerifiedFactor({
        factors: [{ ...verified("p", "2026-09-01T00:00:00Z"), factor_type: "phone" }],
      }),
    ).toBe(true);
    expect(hasVerifiedFactor({ factors: [] })).toBe(false);
    expect(hasVerifiedFactor(null)).toBe(false);
    expect(
      hasVerifiedFactor({ factors: [{ ...verified("a", "2026-09-01T00:00:00Z"), status: "unverified" }] }),
    ).toBe(false);
  });
});

describe("assuranceFrom", () => {
  const enrolledUser = { factors: [verified("f1", "2026-09-01T00:00:00Z")] };

  it("reads level and both kinds of timestamp from the token", () => {
    const a = assuranceFrom(
      enrolledUser,
      token({
        aal: "aal2",
        amr: [
          { method: "totp", timestamp: NOW - 30 },
          { method: "password", timestamp: NOW - 600 },
        ],
      }),
    );
    expect(a).toMatchObject({
      enrolled: true,
      level: "aal2",
      secondFactorAt: NOW - 30,
      signedInAt: NOW - 600,
    });
    expect(a.factors.map((f) => f.id)).toEqual(["f1"]);
  });

  it("recognises the mfa/* spellings of a second factor", () => {
    const a = assuranceFrom(
      enrolledUser,
      token({ aal: "aal2", amr: [{ method: "mfa/totp", timestamp: NOW }] }),
    );
    expect(a.secondFactorAt).toBe(NOW);
    expect(a.signedInAt).toBeNull();
  });

  it("reads a missing or unknown aal claim as aal1", () => {
    expect(assuranceFrom(enrolledUser, token({})).level).toBe("aal1");
    expect(assuranceFrom(enrolledUser, token({ aal: "AAL2" })).level).toBe("aal1");
    expect(assuranceFrom(enrolledUser, token({ aal: "aal3" })).level).toBe("aal1");
  });

  it("FAILS CLOSED without a token: an enrolled account still owes its code", () => {
    const a = assuranceFrom(enrolledUser, null);
    expect(a.level).toBe("aal1");
    expect(needsSecondFactor(a)).toBe(true);
  });

  it("ignores RFC 8176 string amr entries, which carry no time", () => {
    const a = assuranceFrom(enrolledUser, token({ aal: "aal2", amr: ["totp", "pwd"] }));
    expect(a.secondFactorAt).toBeNull();
    expect(a.signedInAt).toBeNull();
  });

  it("ignores malformed amr entries rather than trusting them", () => {
    const a = assuranceFrom(
      enrolledUser,
      token({
        aal: "aal2",
        amr: [
          { method: "totp", timestamp: "now" },
          { method: "totp", timestamp: Number.NaN },
          { method: 7, timestamp: NOW },
          null,
          { method: "totp", timestamp: NOW - 5 },
        ],
      }),
    );
    expect(a.secondFactorAt).toBe(NOW - 5);
  });
});

describe("needsSecondFactor", () => {
  const base = { secondFactorAt: null, signedInAt: NOW, factors: [] };

  it("is true only for an enrolled account on an aal1 session", () => {
    expect(needsSecondFactor({ ...base, enrolled: true, level: "aal1" })).toBe(true);
    expect(needsSecondFactor({ ...base, enrolled: true, level: "aal2" })).toBe(false);
    expect(needsSecondFactor({ ...base, enrolled: false, level: "aal1" })).toBe(false);
    expect(needsSecondFactor(null)).toBe(false);
  });
});

describe("secondFactorIsFresh", () => {
  const fresh = (secondFactorAt: number | null, extra: Partial<{ enrolled: boolean; level: "aal1" | "aal2" }> = {}) => ({
    enrolled: true,
    level: "aal2" as const,
    secondFactorAt,
    signedInAt: NOW - 3600,
    factors: [],
    ...extra,
  });

  it("is true inside the window and false outside it", () => {
    expect(secondFactorIsFresh(fresh(NOW - 60), STEP_UP_WINDOW_SECONDS, NOW)).toBe(true);
    expect(secondFactorIsFresh(fresh(NOW - STEP_UP_WINDOW_SECONDS), STEP_UP_WINDOW_SECONDS, NOW)).toBe(true);
    expect(secondFactorIsFresh(fresh(NOW - STEP_UP_WINDOW_SECONDS - 1), STEP_UP_WINDOW_SECONDS, NOW)).toBe(false);
  });

  it("is never fresh without 2FA, at aal1, or with no second-factor time", () => {
    expect(secondFactorIsFresh(fresh(NOW, { enrolled: false }), 600, NOW)).toBe(false);
    expect(secondFactorIsFresh(fresh(NOW, { level: "aal1" }), 600, NOW)).toBe(false);
    expect(secondFactorIsFresh(fresh(null), 600, NOW)).toBe(false);
    expect(secondFactorIsFresh(null, 600, NOW)).toBe(false);
  });

  it("tolerates a minute of clock skew and refuses a timestamp from further in the future", () => {
    expect(secondFactorIsFresh(fresh(NOW + 30), 600, NOW)).toBe(true);
    expect(secondFactorIsFresh(fresh(NOW + 3600), 600, NOW)).toBe(false);
  });
});

describe("stepUpFreshUntil", () => {
  it("is null without 2FA (never ask), 0 when nothing is fresh, else the window end", () => {
    const common = { signedInAt: NOW, factors: [] };
    expect(stepUpFreshUntil({ ...common, enrolled: false, level: "aal1", secondFactorAt: null })).toBeNull();
    expect(stepUpFreshUntil(null)).toBeNull();
    expect(stepUpFreshUntil({ ...common, enrolled: true, level: "aal1", secondFactorAt: NOW })).toBe(0);
    expect(stepUpFreshUntil({ ...common, enrolled: true, level: "aal2", secondFactorAt: null })).toBe(0);
    expect(stepUpFreshUntil({ ...common, enrolled: true, level: "aal2", secondFactorAt: NOW })).toBe(
      NOW + STEP_UP_WINDOW_SECONDS,
    );
  });
});

describe("signedInRecently", () => {
  const at = (signedInAt: number | null) => ({
    enrolled: false,
    level: "aal1" as const,
    secondFactorAt: null,
    signedInAt,
    factors: [],
  });

  it("measures the FIRST factor's age", () => {
    expect(signedInRecently(at(NOW - 60), RECENT_SIGN_IN_SECONDS, NOW)).toBe(true);
    expect(signedInRecently(at(NOW - RECENT_SIGN_IN_SECONDS - 1), RECENT_SIGN_IN_SECONDS, NOW)).toBe(false);
    expect(signedInRecently(at(null), RECENT_SIGN_IN_SECONDS, NOW)).toBe(false);
    expect(signedInRecently(at(NOW + 3600), RECENT_SIGN_IN_SECONDS, NOW)).toBe(false);
  });
});
