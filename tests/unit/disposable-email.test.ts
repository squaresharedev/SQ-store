// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("searches a list that is sorted, which the binary search depends on", async () => {
    const list = (await import("disposable-email-domains")).default as string[];
    expect(list.length).toBeGreaterThan(100_000);
    for (let i = 1; i < list.length; i += 1) {
      if (list[i - 1] >= list[i]) throw new Error(`not sorted at ${i}: ${list[i - 1]} then ${list[i]}`);
    }
  });

  it("finds the first and last entries, not just the middle", async () => {
    const list = (await import("disposable-email-domains")).default as string[];
    expect(isDisposableEmailDomain(`a@${list[0]}`)).toBe(true);
    expect(isDisposableEmailDomain(`a@${list[list.length - 1]}`)).toBe(true);
  });

  it("is only ever required lazily: a static import costs about 20 MB on every Worker", () => {
    // `import list from "disposable-email-domains"` is turned by the bundler into
    // a namespace with one getter per entry. A Worker isolate is killed at 128 MB
    // (Cloudflare Error 1102), so this list must be read through the one lazy
    // `require` in lib/validation/disposable-email.ts and nowhere else.
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const code = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
          if (/\bfrom\s+["']disposable-email-domains["']|import\(["']disposable-email-domains["']\)/.test(code)) offenders.push(path);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });
});
