// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isDisposableEmailDomain } from "@/lib/validation/disposable-email";

describe("isDisposableEmailDomain", () => {
  it("blocks well-known throwaway providers", () => {
    for (const domain of [
      "mailinator.com",
      "yopmail.com",
      "10minutemail.com",
      "guerrillamail.com",
      "trashmail.com",
    ]) {
      expect(isDisposableEmailDomain(`someone@${domain}`), domain).toBe(true);
    }
  });

  it("allows ordinary providers and the product's own domain", () => {
    for (const domain of ["gmail.com", "example.com", "squareshare.to"]) {
      expect(isDisposableEmailDomain(`someone@${domain}`), domain).toBe(false);
    }
  });

  it("is case-insensitive on the domain", () => {
    expect(isDisposableEmailDomain("someone@Mailinator.COM")).toBe(true);
  });

  it("catches a throwaway subdomain of a listed base domain", () => {
    expect(isDisposableEmailDomain("someone@sub.mailinator.com")).toBe(true);
  });

  it("does not treat a lookalike domain as the listed one", () => {
    // "mailinator.com.evil.com" is NOT a subdomain of mailinator.com; it's a
    // subdomain of evil.com that merely contains the string.
    expect(isDisposableEmailDomain("someone@mailinator.com.evil.com")).toBe(false);
    expect(isDisposableEmailDomain("someone@mailinatorclone.com")).toBe(false);
  });

  it("treats a malformed address as not disposable, leaving format rejection to emailAddress()", () => {
    for (const bad of ["not-an-email", "", "@", "someone@"]) {
      expect(isDisposableEmailDomain(bad), bad).toBe(false);
    }
  });
});
