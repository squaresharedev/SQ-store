// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  boundedInt,
  emailAddress,
  hexColor,
  hostname,
  isStrictHexColor,
  multiLineText,
  normalizeHostname,
  optionalSingleLineText,
  singleLineText,
  uniqueList,
  uuidField,
} from "@/lib/validation/inputs";

/** Build a control character without writing a raw one into this file. */
const ctrl = (code: number) => String.fromCharCode(code);

describe("singleLineText", () => {
  const field = singleLineText({ label: "Title", max: 10 });

  it("accepts ordinary text and trims it", () => {
    expect(field.parse("  hello  ")).toBe("hello");
  });

  it("rejects whitespace-only input rather than storing a blank", () => {
    // Trim runs BEFORE min, so "   " fails as empty instead of passing at 3.
    expect(field.safeParse("   ").success).toBe(false);
  });

  it("rejects every control character, including newline and DEL", () => {
    for (const code of [0, 9, 10, 13, 27, 31, 127]) {
      expect(field.safeParse(`ab${ctrl(code)}cd`).success, `code ${code}`).toBe(false);
    }
  });

  it("enforces the length cap", () => {
    expect(field.safeParse("x".repeat(11)).success).toBe(false);
    expect(field.safeParse("x".repeat(10)).success).toBe(true);
  });

  it("allows empty when made optional", () => {
    const optional = optionalSingleLineText({ label: "VAT", max: 10 });
    expect(optional.parse("")).toBe("");
    expect(optional.safeParse(ctrl(0)).success).toBe(false);
  });
});

describe("multiLineText", () => {
  const field = multiLineText({ label: "Bio", max: 100 });

  it("allows newlines", () => {
    expect(field.parse("one\ntwo")).toBe("one\ntwo");
  });

  it("still rejects carriage return and the other control characters", () => {
    // CR matters: a bare CR/LF pair in a header field is header injection.
    for (const code of [0, 9, 13, 27, 127]) {
      expect(field.safeParse(`a${ctrl(code)}b`).success, `code ${code}`).toBe(false);
    }
  });
});

describe("emailAddress", () => {
  const field = emailAddress();

  it("accepts a normal address", () => {
    expect(field.safeParse("someone@example.com").success).toBe(true);
  });

  it("rejects a header-injection attempt", () => {
    expect(field.safeParse(`a@b.com${ctrl(13)}${ctrl(10)}Bcc: x@y.com`).success).toBe(
      false,
    );
  });

  it("rejects an over-long address", () => {
    expect(field.safeParse(`${"a".repeat(250)}@example.com`).success).toBe(false);
  });
});

describe("hostname", () => {
  const field = hostname();

  it("accepts bare domains and subdomains", () => {
    for (const good of ["example.com", "shop.example.com", "a-b.co.uk", "xn--80ak6aa92e.com"]) {
      expect(field.safeParse(good).success, good).toBe(true);
    }
  });

  it("rejects every shape that isn't a bare host", () => {
    const bad = [
      "https://example.com", // scheme
      "example.com/path", // path
      "example.com:8080", // port
      "user@example.com", // userinfo
      "*.example.com", // wildcard
      "//example.com", // protocol-relative
      "example.com.", // trailing dot
      "example", // no TLD
      "EXAMPLE.com", // uppercase (normalize first)
      "exa mple.com", // space
      "<script>.com", // markup
      "-example.com", // leading hyphen
      "example-.com", // trailing hyphen
    ];
    for (const value of bad) {
      expect(field.safeParse(value).success, value).toBe(false);
    }
  });

  it("rejects non-ASCII homographs", () => {
    // Cyrillic "е" (U+0435) reads as Latin "e" but is a different domain.
    expect(field.safeParse("еxample.com").success).toBe(false);
  });
});

describe("normalizeHostname", () => {
  it("lowercases and strips scheme and path", () => {
    expect(normalizeHostname("  HTTPS://Shop.Example.com/a/b  ")).toBe(
      "shop.example.com",
    );
    expect(normalizeHostname("http://x.com")).toBe("x.com");
  });

  it("never rescues an invalid host into a valid one", () => {
    // The dangerous case: "//evil.com" must not become "evil.com".
    expect(normalizeHostname("//evil.com")).toBe("");
    expect(hostname().safeParse(normalizeHostname("//evil.com")).success).toBe(false);
    // Ports and userinfo survive normalization and are then rejected.
    expect(hostname().safeParse(normalizeHostname("x.com:8080")).success).toBe(false);
    expect(hostname().safeParse(normalizeHostname("a@x.com")).success).toBe(false);
  });
});

describe("hexColor", () => {
  it("accepts only 6-digit hex", () => {
    expect(hexColor().safeParse("#a855f7").success).toBe(true);
    for (const bad of ["#fff", "a855f7", "#ggghhh", "red", "#a855f7;", "url(x)"]) {
      expect(hexColor().safeParse(bad).success, bad).toBe(false);
    }
  });

  it("exposes the same rule as a predicate for the render path", () => {
    expect(isStrictHexColor("#a855f7")).toBe(true);
    expect(isStrictHexColor("red")).toBe(false);
  });
});

describe("boundedInt", () => {
  const field = boundedInt({ label: "Stock", min: 0, max: 100 });

  it("rejects floats, NaN and Infinity", () => {
    for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(field.safeParse(bad).success, String(bad)).toBe(false);
    }
  });

  it("enforces both bounds inclusively", () => {
    expect(field.safeParse(0).success).toBe(true);
    expect(field.safeParse(100).success).toBe(true);
    expect(field.safeParse(-1).success).toBe(false);
    expect(field.safeParse(101).success).toBe(false);
  });
});

describe("uniqueList", () => {
  const field = uniqueList(hostname(), { label: "domains", max: 2 });

  it("rejects duplicates and over-long lists", () => {
    expect(field.safeParse(["a.com", "a.com"]).success).toBe(false);
    expect(field.safeParse(["a.com", "b.com", "c.com"]).success).toBe(false);
    expect(field.safeParse(["a.com", "b.com"]).success).toBe(true);
  });

  it("still applies the item rule to every entry", () => {
    expect(field.safeParse(["a.com", "*.b.com"]).success).toBe(false);
  });
});

// ==========================================================================
// Hygiene guard
// ==========================================================================

const VALIDATION_DIR = join(process.cwd(), "src", "lib", "validation");

/**
 * Schema modules must build fields from the primitives, not hand-roll them.
 * Listed exceptions are values that are NOT user prose and have their own
 * documented rule.
 */
const RAW_STRING_ALLOWED: Record<string, string> = {
  "inputs.ts": "defines the primitives",
  "product.ts":
    "R2 object keys: an opaque server-minted path with its own strict pattern, not user prose",
  "settings.ts":
    "password fields: deliberately unconstrained in shape (any characters allowed), bounded only by length",
  "notifications.ts": "internal payload record, never user-typed",
};

describe("validation hygiene", () => {
  const files = readdirSync(VALIDATION_DIR).filter((f) => f.endsWith(".ts"));

  it("finds the schema modules", () => {
    expect(files.length).toBeGreaterThan(3);
  });

  it("no schema module hand-rolls a regex outside the primitives", () => {
    // A regex at a call site is how fields drifted apart in the first place:
    // some got the control-character gate, some did not.
    const offenders: string[] = [];
    for (const file of files) {
      if (file === "inputs.ts") continue;
      const source = readFileSync(join(VALIDATION_DIR, file), "utf8");
      source.split(/\r?\n/).forEach((line, index) => {
        if (/\.regex\(\s*\//.test(line)) offenders.push(`${file}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("every module using raw z.string() is a documented exception", () => {
    const undocumented = files.filter((file) => {
      const source = readFileSync(join(VALIDATION_DIR, file), "utf8");
      return /z\.string\(\)/.test(source) && !(file in RAW_STRING_ALLOWED);
    });
    expect(undocumented).toEqual([]);
  });

  it("has no stale exceptions", () => {
    const stale = Object.keys(RAW_STRING_ALLOWED).filter((file) => {
      if (!files.includes(file)) return true;
      const source = readFileSync(join(VALIDATION_DIR, file), "utf8");
      return !/z\.string\(\)/.test(source);
    });
    expect(stale).toEqual([]);
  });
});

/** Unused here, but keeps the import list honest if a primitive is dropped. */
void uuidField;
void statSync;
