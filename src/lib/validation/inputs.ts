import { z } from "zod";
import type { Messages } from "@/i18n/messages";
import { issueKey, isValidationKey } from "@/lib/validation/messages";

/**
 * THE input primitives. Every user-supplied field in the product is built from
 * one of these, so the gates that matter are applied by CONSTRUCTION rather
 * than remembered per field.
 *
 * The problem this solves: gates used to be applied by hand, so some fields
 * had them and some didn't. Product titles and notification titles were plain
 * `z.string()` while storefront text was control-character gated — the
 * difference was an oversight, not a decision, and nothing made that visible.
 *
 * RULES
 * - Reach for a primitive. If none fits, add one HERE rather than hand-rolling
 *   a regex at the call site; `tests/unit/validation-primitives.test.ts` fails
 *   on raw `z.string()` in a schema module.
 * - These are the SERVER boundary. Client-side copies of the same schema are a
 *   UX convenience; the action re-parses everything.
 * - None of this is the XSS defence: user text is always rendered as React
 *   text nodes, never markup. This keeps stored data sane and keeps control
 *   characters out of places (email headers, notification bodies) where they
 *   mean something.
 * - Messages are keys (see ./messages.ts). A primitive takes the FIELD it
 *   validates, and each field owns whole sentences in the Validation catalogue:
 *   "is required" cannot be glued onto a translated noun, because the noun's
 *   form changes with the sentence around it.
 */

type ValidationCatalogue = Messages["Validation"];

/** A free-text field, named by its entry under Validation.text. */
export type TextField = keyof ValidationCatalogue["text"];
export type EmailField = keyof ValidationCatalogue["email"];
export type UuidField = keyof ValidationCatalogue["uuid"];
export type HandleField = keyof ValidationCatalogue["handle"];
export type HostnameField = keyof ValidationCatalogue["hostname"];
export type ReferenceCodeField = keyof ValidationCatalogue["referenceCode"];
export type OneTimeCodeField = keyof ValidationCatalogue["oneTimeCode"];
export type HexColorField = keyof ValidationCatalogue["hexColor"];
export type IntField = keyof ValidationCatalogue["int"];
export type ListField = keyof ValidationCatalogue["list"];

// ── Text ────────────────────────────────────────────────────────────────

/** Control characters are rejected outright; the multiline variant re-admits
 *  only newline. An embedded CR/LF in a display name is header injection once
 *  invite mail is wired, which is why this is not merely cosmetic. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const CONTROL_CHARS_EXCEPT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f]/;

/**
 * A single-line, control-character-free string. Trimmed before every check, so
 * a field of pure whitespace fails `min` instead of passing it.
 */
export function singleLineText(options: {
  /** The field, which decides the wording of every message. */
  field: TextField;
  max: number;
  /** Default 1: single-line fields are required unless stated otherwise. */
  min?: number;
}) {
  const { field, max, min = 1 } = options;
  return z
    .string()
    .trim()
    .min(min, min > 1 ? tooShortKey(field) : issueKey(`Validation.text.${field}.required`))
    .max(max, issueKey(`Validation.text.${field}.tooLong`))
    .refine((value) => !CONTROL_CHARS.test(value), {
      error: issueKey(`Validation.text.${field}.unsupported`),
    });
}

/**
 * "Needs at least N characters" exists only for the fields that set a minimum
 * above one, so it is looked up rather than assumed. A field missing it is a
 * mistake in this codebase, reported when the schema is built.
 */
function tooShortKey(field: TextField): string {
  const key = `Validation.text.${field}.tooShort`;
  if (!isValidationKey(key)) {
    throw new Error(`[validation] ${key} is missing from the catalogue`);
  }
  return issueKey(key);
}

/** Multi-line text: newlines allowed, every other control character rejected. */
export function multiLineText(options: {
  field: TextField;
  max: number;
  min?: number;
}) {
  const { field, max, min = 0 } = options;
  return z
    .string()
    .trim()
    .min(min, issueKey(`Validation.text.${field}.required`))
    .max(max, issueKey(`Validation.text.${field}.tooLong`))
    .refine((value) => !CONTROL_CHARS_EXCEPT_NEWLINE.test(value), {
      error: issueKey(`Validation.text.${field}.unsupported`),
    });
}

/** Optional single-line field where empty string means "not set". */
export function optionalSingleLineText(options: { field: TextField; max: number }) {
  return singleLineText({ ...options, min: 0 });
}

// ── Identity ────────────────────────────────────────────────────────────

/** A UUID we minted (row ids, storefront ids, embed keys). */
export function uuidField(field: UuidField = "id") {
  return z.uuid({ error: issueKey(`Validation.uuid.${field}`) });
}

/**
 * An email address. Capped at the RFC 5321 maximum so an absurd string can't
 * ride into the mail path, and control-char gated for the same header-safety
 * reason as single-line text.
 */
export function emailAddress(field: EmailField = "generic") {
  return z
    .email({ error: issueKey(`Validation.email.${field}.format`) })
    .max(254, issueKey(`Validation.email.${field}.tooLong`))
    .refine((value) => !CONTROL_CHARS.test(value), {
      error: issueKey(`Validation.email.${field}.unsupported`),
    });
}

/**
 * An account HANDLE: what someone types into the sign-in box instead of their
 * email. ASCII lowercase letters, digits and underscore, 3 to 30 characters.
 *
 * Deliberately far narrower than a display name, because a handle is half of a
 * credential AND is shown to other people. It must not admit anything that can
 * render as something it is not: no spaces, no case ambiguity, and no non-ASCII
 * (a Cyrillic "а" would otherwise sit beside a Latin "a" as a different but
 * visually identical account). Same homograph reasoning as `hostname` below.
 *
 * Trimmed and lowercased BEFORE the check, so "  BuilderBoy " is accepted and
 * normalized to "builderboy" rather than rejected. The parsed output is the
 * canonical form and is what every write path stores.
 */
const HANDLE_PATTERN = /^[a-z0-9_]{3,30}$/;

export function handle(field: HandleField = "username") {
  return z
    .string()
    .trim()
    .toLowerCase()
    .regex(HANDLE_PATTERN, {
      error: issueKey(`Validation.handle.${field}`),
    });
}

/**
 * A bare hostname, as typed into an origin allowlist.
 *
 * ASCII only, lowercase, dot-separated labels of ≤63 chars with an alphabetic
 * TLD, ≤253 total. This deliberately rejects: a scheme or path
 * ("https://x.com/y"), a port ("x.com:8080"), userinfo ("a@x.com"), a wildcard
 * ("*.x.com"), a protocol-relative host ("//x.com"), a trailing dot, and any
 * non-ASCII label — the last of which blocks homograph lookalikes such as a
 * Cyrillic "е" standing in for "e". Punycode ("xn--…") still passes, since it
 * IS ASCII and is what a browser actually compares.
 *
 * It is only ever compared against a request origin's hostname or rendered as
 * a text node — never interpolated into markup or a URL.
 */
const HOSTNAME_PATTERN =
  /^(?=[a-z0-9.-]{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?[.])+[a-z]{2,63}$/;

export function hostname(field: HostnameField = "domains") {
  return z.string().regex(HOSTNAME_PATTERN, {
    error: issueKey(`Validation.hostname.${field}`),
  });
}

/**
 * Normalize free-typed host input BEFORE validation: lowercases, strips a
 * scheme and anything from the first slash, drops surrounding whitespace.
 *
 * Paste-friendliness only. It never RESCUES an invalid host — `hostname()`
 * still has the final say, so "//evil.com" normalizes to "" and is rejected
 * rather than silently becoming a domain.
 */
export function normalizeHostname(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (value.startsWith("https://")) value = value.slice(8);
  else if (value.startsWith("http://")) value = value.slice(7);
  return value.split("/")[0] ?? "";
}

/**
 * A short reference CODE rather than prose: letters, digits, and the few
 * separators such codes use (space, dot, hyphen). VAT and tax identifiers are
 * the case here — they end up on invoices and in tax exports, so the character
 * set is deliberately narrow rather than "any single-line text".
 *
 * Empty is allowed and means "not set"; the caller decides how to store that.
 */
const CODE_PATTERN = /^[A-Za-z0-9 .-]+$/;

export function referenceCode(options: {
  field: ReferenceCodeField;
  min: number;
  max: number;
}) {
  const { field, min, max } = options;
  return z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" ||
        (value.length >= min && value.length <= max && CODE_PATTERN.test(value)),
      { error: issueKey(`Validation.referenceCode.${field}`), params: { min, max } },
    );
}

/**
 * A six-digit one-time code from an authenticator app. Spaces anywhere are
 * dropped first ("123 456" is how most apps display it, and how people type
 * it back), then exactly six ASCII digits are required: never a longer string
 * that happens to start with six, and never a non-ASCII digit that a lax
 * `\d` could let through.
 */
export function oneTimeCode(field: OneTimeCodeField = "authenticator") {
  return z
    .string()
    .transform((value) => value.replace(/\s+/g, ""))
    .pipe(
      z.string().regex(/^[0-9]{6}$/, {
        error: issueKey(`Validation.oneTimeCode.${field}`),
      }),
    );
}

// ── Values ──────────────────────────────────────────────────────────────

/** Strict 6-digit hex. Gates every colour before it reaches a style attribute. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function hexColor(field: HexColorField = "colors") {
  return z.string().regex(HEX_COLOR_PATTERN, {
    error: issueKey(`Validation.hexColor.${field}`),
  });
}

/** Predicate form, for the render path's re-gate before a style attribute. */
export function isStrictHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/** A whole number inside explicit bounds. Rejects floats, NaN and Infinity. */
export function boundedInt(options: {
  field: IntField;
  min: number;
  max: number;
}) {
  const { field, min, max } = options;
  return z
    .number()
    .int(issueKey(`Validation.int.${field}.whole`))
    .min(min, issueKey(`Validation.int.${field}.tooSmall`))
    .max(max, issueKey(`Validation.int.${field}.tooBig`));
}

/** A bounded list with no duplicates. */
export function uniqueList<T extends z.ZodType>(
  item: T,
  options: { field: ListField; max: number },
) {
  return z
    .array(item)
    .max(options.max, issueKey(`Validation.list.${options.field}.tooMany`))
    .refine((values) => new Set(values).size === values.length, {
      error: issueKey(`Validation.list.${options.field}.duplicate`),
    });
}
