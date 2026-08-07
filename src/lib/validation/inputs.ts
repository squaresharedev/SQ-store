import { z } from "zod";

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
 */

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
  /** Field name used in the error, e.g. "A product needs a title." */
  label: string;
  max: number;
  /** Default 1: single-line fields are required unless stated otherwise. */
  min?: number;
}) {
  const { label, max, min = 1 } = options;
  return z
    .string()
    .trim()
    .min(min, min === 1 ? `${label} is required.` : `${label} needs at least ${min} characters.`)
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine((value) => !CONTROL_CHARS.test(value), {
      error: `${label} contains unsupported characters.`,
    });
}

/** Multi-line text: newlines allowed, every other control character rejected. */
export function multiLineText(options: {
  label: string;
  max: number;
  min?: number;
}) {
  const { label, max, min = 0 } = options;
  return z
    .string()
    .trim()
    .min(min, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`)
    .refine((value) => !CONTROL_CHARS_EXCEPT_NEWLINE.test(value), {
      error: `${label} contains unsupported characters.`,
    });
}

/** Optional single-line field where empty string means "not set". */
export function optionalSingleLineText(options: { label: string; max: number }) {
  return singleLineText({ ...options, min: 0 });
}

// ── Identity ────────────────────────────────────────────────────────────

/** A UUID we minted (row ids, storefront ids, embed keys). */
export function uuidField(label = "That id") {
  return z.uuid({ error: `${label} is not valid.` });
}

/**
 * An email address. Capped at the RFC 5321 maximum so an absurd string can't
 * ride into the mail path, and control-char gated for the same header-safety
 * reason as single-line text.
 */
export function emailAddress(label = "That email") {
  return z
    .email({ error: `${label} doesn't look like an email address.` })
    .max(254, `${label} is too long.`)
    .refine((value) => !CONTROL_CHARS.test(value), {
      error: `${label} contains unsupported characters.`,
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

export function handle(label = "A username") {
  return z
    .string()
    .trim()
    .toLowerCase()
    .regex(HANDLE_PATTERN, {
      error: `${label} must be 3 to 30 characters, using only letters, numbers and underscores.`,
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

export function hostname(label = "Domains") {
  return z.string().regex(HOSTNAME_PATTERN, {
    error: `${label} must be bare lowercase domains like yoursite.com — no https://, port, path, or wildcard.`,
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
  label: string;
  min: number;
  max: number;
}) {
  const { label, min, max } = options;
  return z
    .string()
    .trim()
    .refine(
      (value) =>
        value === "" ||
        (value.length >= min && value.length <= max && CODE_PATTERN.test(value)),
      { error: `${label} must be ${min} to ${max} letters, digits, spaces, dots or hyphens.` },
    );
}

// ── Values ──────────────────────────────────────────────────────────────

/** Strict 6-digit hex. Gates every colour before it reaches a style attribute. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function hexColor(label = "Colors") {
  return z.string().regex(HEX_COLOR_PATTERN, {
    error: `${label} must be 6-digit hex, like #a855f7.`,
  });
}

/** Predicate form, for the render path's re-gate before a style attribute. */
export function isStrictHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

/** A whole number inside explicit bounds. Rejects floats, NaN and Infinity. */
export function boundedInt(options: {
  label: string;
  min: number;
  max: number;
}) {
  const { label, min, max } = options;
  return z
    .number()
    .int(`${label} must be a whole number.`)
    .min(min, `${label} must be ${min} or more.`)
    .max(max, `${label} must be ${max} or fewer.`);
}

/** A bounded list with no duplicates. */
export function uniqueList<T extends z.ZodType>(
  item: T,
  options: { label: string; max: number },
) {
  return z
    .array(item)
    .max(options.max, `List up to ${options.max} ${options.label}.`)
    .refine((values) => new Set(values).size === values.length, {
      error: `Each entry in ${options.label} can only be listed once.`,
    });
}
