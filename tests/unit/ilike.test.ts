import { describe, expect, it } from "vitest";
import { escapeIlike } from "@/lib/supabase/ilike";

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
