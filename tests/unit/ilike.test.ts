import { describe, expect, it } from "vitest";
import { MAX_ILIKE_TERM_LENGTH, escapeIlike } from "@/lib/supabase/ilike";

// Shared by the orders (buyer email) and products (title) searches. The value
// is parameterised by PostgREST, so this is about the MATCH being what the
// user typed, not about SQL injection.

describe("escapeIlike", () => {
  it("leaves ordinary terms untouched", () => {
    expect(escapeIlike("blue hoodie")).toBe("blue hoodie");
    expect(escapeIlike("someone@example.com")).toBe("someone@example.com");
  });

  it("escapes the wildcards so they match literally", () => {
    // Without escaping, "50%" matches everything starting "50".
    expect(escapeIlike("50%")).toBe("50\\%");
    // "_" is a single-character wildcard, so "a_b" would match "axb".
    expect(escapeIlike("a_b")).toBe("a\\_b");
  });

  it("escapes the escape character first, so it can't double-escape", () => {
    // A lone backslash becomes an escaped backslash, not the start of an
    // escape sequence swallowing the next character.
    expect(escapeIlike("\\")).toBe("\\\\");
    expect(escapeIlike("\\%")).toBe("\\\\\\%");
  });

  it("escapes every occurrence, not just the first", () => {
    expect(escapeIlike("%a%b%")).toBe("\\%a\\%b\\%");
    expect(escapeIlike("__")).toBe("\\_\\_");
  });

  it("is a no-op on the empty string", () => {
    expect(escapeIlike("")).toBe("");
  });
});

describe("escapeIlike — the length backstop", () => {
  // Not injection (PostgREST parameterises the value); this bounds what a
  // surface whose term comes from a URL can hand to a per-row LIKE match.

  it("leaves anything of a plausible length alone", () => {
    // The two longest terms that can legitimately match: a product title
    // (200) and an email address (254).
    for (const length of [200, 254, MAX_ILIKE_TERM_LENGTH]) {
      const term = "a".repeat(length);
      expect(escapeIlike(term), String(length)).toBe(term);
    }
  });

  it("truncates a term past the backstop", () => {
    expect(escapeIlike("a".repeat(1_000_000))).toHaveLength(
      MAX_ILIKE_TERM_LENGTH,
    );
  });

  it("truncates BEFORE escaping, so it cannot emit a dangling escape", () => {
    // Slicing escaped output could cut "\%" in half and leave a trailing lone
    // backslash — an invalid escape sequence that Postgres ERRORS on, turning
    // the safety clamp into the bug. Every % in this term escapes to two
    // characters, so a naive post-escape slice would land mid-pair.
    const escaped = escapeIlike("%".repeat(MAX_ILIKE_TERM_LENGTH + 50));
    expect(escaped).toBe("\\%".repeat(MAX_ILIKE_TERM_LENGTH));
    // Every backslash still has the character it escapes after it.
    expect(escaped.endsWith("\\")).toBe(false);
  });
});
