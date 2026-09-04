// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUTH_INTENTS,
  EMAIL_OTP_TYPES,
  authIntentSchema,
  emailOtpTypeSchema,
} from "@/lib/validation/auth";

/**
 * The auth surface takes three values straight off the wire — the submit
 * button's `intent`, the OTP `type` in a confirmation link, and the email
 * address every mail-sending branch uses. All three used to be TYPE ASSERTIONS:
 * `formData.get("intent") as AuthIntent`, `searchParams.get("type") as
 * EmailOtpType`, and an `includes("@")` check standing in for a format check.
 *
 * A cast is a claim, not a check — it compiles to nothing. None of the three
 * was exploitable (an unknown intent fell through to the password branch, an
 * unknown OTP type was refused by the auth server, and a malformed address was
 * refused by GoTrue), but each one asserted a guarantee nobody was enforcing,
 * and the email case spent a rate-limit budget before finding out.
 *
 * These tests pin the parse. The source-level assertions at the bottom exist
 * because the runtime ones cannot tell a real parse from a cast that happens
 * to be given good input.
 */

describe("authIntentSchema", () => {
  it("accepts every intent the sign-in screen can post", () => {
    for (const intent of AUTH_INTENTS) {
      expect(authIntentSchema.safeParse(intent).success).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const value of [
      "admin",
      "signin ",
      "SIGNIN",
      "",
      "reset\n",
      null,
      undefined,
      42,
      {},
    ]) {
      expect(authIntentSchema.safeParse(value).success).toBe(false);
    }
  });

  it("covers exactly the four branches authenticate() implements", () => {
    // If a fifth intent is added to the union without a branch, or a branch is
    // added without the union, this is where the two drift apart.
    expect([...AUTH_INTENTS].sort()).toEqual([
      "magic",
      "reset",
      "signin",
      "signup",
    ]);
  });
});

describe("emailOtpTypeSchema", () => {
  it("accepts the OTP kinds the email templates link to", () => {
    for (const type of EMAIL_OTP_TYPES) {
      expect(emailOtpTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it("rejects arbitrary strings", () => {
    // Supabase types EmailOtpType as a union widened with `(string & {})`, so
    // TypeScript accepts any string here and the old cast waved all of these
    // through to the auth server.
    for (const value of ["", "sql", "../recovery", "SIGNUP", null, undefined, 7]) {
      expect(emailOtpTypeSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("no type assertions remain on wire input", () => {
  const read = (relative: string) =>
    readFileSync(join(process.cwd(), relative), "utf8");

  it("parses the auth intent instead of casting it", () => {
    const source = read("src/lib/auth/actions.ts");
    expect(source).not.toMatch(/as\s+AuthIntent/);
    expect(source).toContain("authIntentSchema.safeParse");
  });

  it("parses the OTP type instead of casting it", () => {
    const source = read("src/app/(auth)/auth/confirm/route.ts");
    expect(source).not.toMatch(/as\s+EmailOtpType/);
    expect(source).toContain("emailOtpTypeSchema.safeParse");
  });

  it("format-checks the address before spending a rate-limit budget", () => {
    const source = read("src/lib/auth/actions.ts");
    // `looksLikeEmail` decides which PATH an identifier takes; it is not and
    // was never a format check. The real parse must sit ahead of every branch
    // that sends mail, so garbage costs the caller nothing.
    expect(source).toContain("emailSchema.safeParse");
    const guardAt = source.indexOf("emailSchema.safeParse");
    const firstBudgetAt = source.indexOf("allowAuthEmail(email)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(firstBudgetAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(firstBudgetAt);
  });

  it("checks for a disposable domain and a solved bot challenge before the signup rate-limit spend", () => {
    // Cheapest-first, same reasoning as the email format check above: a
    // throwaway domain (free, local, no network) and a failed bot check
    // (network, but stops a scripted loop cold) should both be settled before
    // a real signup attempt draws down the per-address/per-client budgets
    // meant for people, not before-the-fact for a request already doomed.
    const source = read("src/lib/auth/actions.ts");
    const disposableAt = source.indexOf("isDisposableEmailDomain(email)");
    const turnstileAt = source.indexOf("verifyTurnstile(turnstileToken");
    // `allowAuthEmail(email)` is called from three branches (magic, reset,
    // signup); the one that matters here is the signup branch's, which is the
    // first occurrence AT OR AFTER the turnstile check.
    const budgetAt = source.indexOf("allowAuthEmail(email)", turnstileAt);
    expect(disposableAt).toBeGreaterThan(-1);
    expect(turnstileAt).toBeGreaterThan(-1);
    expect(budgetAt).toBeGreaterThan(-1);
    expect(disposableAt).toBeLessThan(turnstileAt);
    expect(turnstileAt).toBeLessThan(budgetAt);
  });
});
