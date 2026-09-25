// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The building blocks the passkey factor stands on: the server's own TOTP
 * (it must compute exactly the codes GoTrue expects), the sealing that keeps
 * the stored secret and the challenge slips worthless outside their context,
 * and how a factor is told apart as a passkey.
 */

import { base32Decode, totpCode } from "@/lib/auth/totp";
import {
  base64UrlDecode,
  base64UrlEncode,
  open,
  passkeySealingConfigured,
  seal,
} from "@/lib/auth/passkey-crypto";
import {
  PASSKEY_FACTOR_PREFIX,
  appFactors,
  hasPasskeyFactor,
  verifiedFactors,
} from "@/lib/auth/assurance";
import { pickFactor } from "@/lib/auth/mfa";
import { factorNameSchema } from "@/lib/validation/mfa";

// 32 zero bytes, base64: a test key, never a real one.
const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("totpCode (RFC 6238, the codes GoTrue checks)", () => {
  // RFC 6238 appendix B, SHA-1: the secret is ASCII "12345678901234567890".
  const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("at t=%i the code is %s", async (seconds, code) => {
    expect(await totpCode(RFC_SECRET, Math.floor(seconds / 30))).toBe(code);
  });

  it("decodes base32 the way authenticator apps do (spaces and case forgiven)", () => {
    expect(Array.from(base32Decode("gezd gnbv"))).toEqual(Array.from(base32Decode("GEZDGNBV")));
    expect(() => base32Decode("not!base32")).toThrow();
  });
});

describe("sealing", () => {
  beforeEach(() => {
    vi.stubEnv("MFA_PASSKEY_KEY", KEY);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips in its own context", async () => {
    const sealed = await seal("JBSWY3DPEHPK3PXP", "passkey-secret:v1:user:factor");
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(await open(sealed!, "passkey-secret:v1:user:factor")).toBe("JBSWY3DPEHPK3PXP");
  });

  it("will not open in another context: another account, another factor", async () => {
    const sealed = await seal("secret", "passkey-secret:v1:alice:factor");
    expect(await open(sealed!, "passkey-secret:v1:bob:factor")).toBeNull();
    expect(await open(sealed!, "passkey-secret:v1:alice:other")).toBeNull();
  });

  it("refuses anything tampered with", async () => {
    const sealed = (await seal("secret", "ctx"))!;
    const bytes = base64UrlDecode(sealed);
    bytes[bytes.length - 1] ^= 1;
    expect(await open(base64UrlEncode(bytes), "ctx")).toBeNull();
    expect(await open("not-a-sealed-value", "ctx")).toBeNull();
  });

  it("uses a fresh nonce every time", async () => {
    expect(await seal("same", "ctx")).not.toBe(await seal("same", "ctx"));
  });

  it("is off (fails closed) without a 32-byte key", async () => {
    vi.stubEnv("MFA_PASSKEY_KEY", "");
    expect(await passkeySealingConfigured()).toBe(false);
    expect(await seal("x", "ctx")).toBeNull();
    vi.stubEnv("MFA_PASSKEY_KEY", "c2hvcnQ");
    expect(await passkeySealingConfigured()).toBe(false);
  });
});

describe("telling a passkey's factor apart", () => {
  const factor = (id: string, name: string, created: string) => ({
    id,
    friendly_name: name,
    factor_type: "totp" as const,
    status: "verified" as const,
    created_at: created,
    updated_at: created,
  });
  const user = {
    factors: [
      factor("f-app", "Pixel 8", "2026-09-01T00:00:00Z"),
      factor("f-key", `${PASSKEY_FACTOR_PREFIX}iPhone`, "2026-09-02T00:00:00Z"),
    ],
  };

  it("reads the prefix and shows the chosen name", () => {
    expect(verifiedFactors(user)).toEqual([
      { id: "f-app", name: "Pixel 8", type: "totp", createdAt: "2026-09-01T00:00:00Z" },
      { id: "f-key", name: "iPhone", type: "passkey", createdAt: "2026-09-02T00:00:00Z" },
    ]);
    expect(hasPasskeyFactor(verifiedFactors(user))).toBe(true);
    expect(appFactors(verifiedFactors(user)).map((f) => f.id)).toEqual(["f-app"]);
  });

  it("never checks a typed code against a passkey's factor", () => {
    const factors = verifiedFactors(user);
    expect(pickFactor({ factors }, null)).toBe("f-app");
    // Named explicitly, it is still refused: nobody can know that secret.
    expect(pickFactor({ factors }, "f-key")).toBeNull();
    const onlyPasskey = factors.filter((f) => f.type === "passkey");
    expect(pickFactor({ factors: onlyPasskey }, null)).toBeNull();
  });

  it("will not let an app borrow the prefix", () => {
    expect(factorNameSchema.safeParse("passkey:fake").success).toBe(false);
    expect(factorNameSchema.safeParse("PASSKEY:fake").success).toBe(false);
    expect(factorNameSchema.safeParse("My passkey").success).toBe(true);
  });
});

describe("relying party", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the app's own host", async () => {
    const { relyingParty } = await import("@/lib/auth/passkeys");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    vi.stubEnv("WEBAUTHN_RP_ID", "");
    vi.stubEnv("WEBAUTHN_ORIGINS", "");
    expect(relyingParty()).toEqual({ rpID: "localhost", origins: ["http://localhost:3000"] });
  });

  it("can widen to the parent domain, and drops origins outside it", async () => {
    const { relyingParty } = await import("@/lib/auth/passkeys");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://dashboard.squareshare.eu");
    vi.stubEnv("WEBAUTHN_RP_ID", "squareshare.eu");
    vi.stubEnv("WEBAUTHN_ORIGINS", "https://app.squareshare.eu, https://evil.example");
    expect(relyingParty()).toEqual({
      rpID: "squareshare.eu",
      origins: ["https://dashboard.squareshare.eu", "https://app.squareshare.eu"],
    });
  });

  it("is off when the RP ID does not cover the app", async () => {
    const { relyingParty } = await import("@/lib/auth/passkeys");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://dashboard.squareshare.eu");
    vi.stubEnv("WEBAUTHN_RP_ID", "example.com");
    expect(relyingParty()).toBeNull();
  });

  it("only looks at credential JSON of a sane size and shape", async () => {
    const { parseCredential } = await import("@/lib/auth/passkeys");
    expect(parseCredential(JSON.stringify({ id: "abc", type: "public-key", response: {} }))).not.toBeNull();
    expect(parseCredential(JSON.stringify({ id: "abc", type: "other", response: {} }))).toBeNull();
    expect(parseCredential("x".repeat(16_001))).toBeNull();
    expect(parseCredential("not json")).toBeNull();
    expect(parseCredential(null)).toBeNull();
  });
});
