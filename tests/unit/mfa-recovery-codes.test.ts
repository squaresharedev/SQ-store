// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  RECOVERY_CODE_COUNT,
  formatRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from "@/lib/auth/recovery-codes";

/**
 * Recovery codes are a second factor in their own right: whoever holds one can
 * switch 2FA off. So their strength, their normalisation (the forgiving part)
 * and their hashing (the stored part) are each pinned here.
 */

const CROCKFORD = /^[0-9abcdefghjkmnpqrstvwxyz]+$/;

describe("generateRecoveryCodes", () => {
  it("makes ten distinct codes in xxxx-xxxx-xxxx-xxxx form", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
      expect(code.replace(/-/g, "")).toMatch(CROCKFORD);
    }
  });

  it("carries 80 bits: 16 characters of a 32-symbol alphabet", () => {
    const [code] = generateRecoveryCodes(1);
    expect(code.replace(/-/g, "")).toHaveLength(16);
  });

  it("never repeats across many sets (a weak RNG would)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      for (const code of generateRecoveryCodes()) seen.add(code);
    }
    expect(seen.size).toBe(2000);
  });

  it("uses every symbol of the alphabet (no bias that drops one)", () => {
    const chars = new Set(generateRecoveryCodes(400).join("").replace(/-/g, ""));
    expect(chars.size).toBe(32);
  });

  it("round-trips through normalisation", () => {
    for (const code of generateRecoveryCodes()) {
      expect(formatRecoveryCode(normalizeRecoveryCode(code)!)).toBe(code);
    }
  });
});

describe("normalizeRecoveryCode", () => {
  const canonical = "7k2m9qpxr4tbhc0w";

  it("forgives case, dashes and spaces", () => {
    for (const typed of [
      "7k2m-9qpx-r4tb-hc0w",
      "7K2M-9QPX-R4TB-HC0W",
      " 7k2m 9qpx r4tb hc0w ",
      "7k2m9qpxr4tbhc0w",
      "7k2m--9qpx-r4tb-hc0w",
    ]) {
      expect(normalizeRecoveryCode(typed), typed).toBe(canonical);
    }
  });

  it("maps the letters Crockford leaves out onto the digits they look like", () => {
    expect(normalizeRecoveryCode("7k2m-9qpx-r4tb-hcOw")).toBe(canonical); // O -> 0
    expect(normalizeRecoveryCode("ikim-9qpx-r4tb-hc0w")).toBe("1k1m9qpxr4tbhc0w"); // i -> 1
    expect(normalizeRecoveryCode("lklm-9qpx-r4tb-hc0w")).toBe("1k1m9qpxr4tbhc0w"); // l -> 1
  });

  it("refuses anything that cannot be a code, before any hashing", () => {
    for (const bad of [
      "",
      "123456", // an authenticator code typed into the wrong box
      "7k2m-9qpx-r4tb-hc0", // too short
      "7k2m-9qpx-r4tb-hc0w-x", // too long
      "7k2m-9qpx-r4tb-hc0u", // u has no twin
      "7k2m_9qpx_r4tb_hc0w", // underscores are not separators
      "7k2m-9qpx-r4tb-hc0✓",
    ]) {
      expect(normalizeRecoveryCode(bad), bad).toBeNull();
    }
  });
});

describe("hashRecoveryCode", () => {
  const USER_A = "10000000-0000-4000-8000-000000000001";
  const USER_B = "20000000-0000-4000-8000-000000000002";

  it("is 64 lowercase hex characters (the column's CHECK)", async () => {
    expect(await hashRecoveryCode(USER_A, "7k2m9qpxr4tbhc0w")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for one account", async () => {
    expect(await hashRecoveryCode(USER_A, "7k2m9qpxr4tbhc0w")).toBe(
      await hashRecoveryCode(USER_A, "7k2m9qpxr4tbhc0w"),
    );
  });

  it("is salted by the account: one code, two accounts, two digests", async () => {
    expect(await hashRecoveryCode(USER_A, "7k2m9qpxr4tbhc0w")).not.toBe(
      await hashRecoveryCode(USER_B, "7k2m9qpxr4tbhc0w"),
    );
  });

  it("never contains the code itself", async () => {
    const digest = await hashRecoveryCode(USER_A, "7k2m9qpxr4tbhc0w");
    expect(digest).not.toContain("7k2m");
  });
});
