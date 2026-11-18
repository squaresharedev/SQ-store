// Zod-free predicate helpers used on the CLIENT render path.
//
// Every function here is also re-exported from its originating schema module
// (inputs.ts, storefront.ts, product.ts via re-export) so server callers keep
// their existing import paths and no server code changes.
//
// WHY A SEPARATE FILE. Turbopack does not tree-shake the app's own modules
// that lack a "sideEffects": false package-level declaration. Any "use client"
// component that imports from inputs.ts, storefront.ts, or product.ts pulls in
// every top-level zod schema built in those modules -- roughly 147 KB raw /
// 40 KB gz of a buyer page's first load. The fix is to put the predicates the
// render path actually needs in a file that never imports zod.

// ── Colours ──────────────────────────────────────────────────────────────

/** Strict 6-digit hex. Gates every colour before it reaches a style attribute. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** True when value is a strict 6-digit hex colour (#rrggbb). */
export function isStrictHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

// ── Seller prose beside a payment ────────────────────────────────────────
//
// Copied from inputs.ts so this module stays zod-free. Keep in sync if the
// original changes.

/** A scheme, a `www.`, or a bare host on a TLD a shop link would use. A short
 *  list on purpose: it has to catch "pay at mystore.shop" without refusing a
 *  sentence that merely lacks a space after its full stop. */
const LINK_LIKE =
  /(?:\b[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|info|biz|io|co|eu|ie|uk|de|at|ch|fr|be|nl|lu|it|es|pt|pl|cz|sk|dk|se|no|fi|shop|store|me|app|link|ly|gl|to|page|site|xyz|online|live|tech|dev|art|world|club|top|pro|ai|fm|tv|cc|ws|gg|ru|cn|br|in|jp|kr|us|ca|au|nz|za|mx|health|shopping|market|bio|social|website|space|cloud|digital)\b)/i;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** Two letters, two check digits, then the account: the shape of an IBAN,
 *  spaced or not. */
const IBAN_LIKE = /\b[a-z]{2}\d{2}(?:\s?[a-z0-9]){11,30}\b/i;

/** Whether text reads as a link, an address to write to, or bank details. */
export function hasContactOrPaymentDetails(value: string): boolean {
  return LINK_LIKE.test(value) || EMAIL_LIKE.test(value) || IBAN_LIKE.test(value);
}

// ── Badges ────────────────────────────────────────────────────────────────

/** True for a badge drawn on the photo rather than beside the product.
 *  Accepts the wider { placement?: string } so this file need not import
 *  BadgePlacement from types/product.ts; callers with the narrower type
 *  satisfy this signature. */
export function isOnPhoto(badge: { placement?: string }): boolean {
  return badge.placement !== undefined && badge.placement !== "beside";
}

// ── Identity ──────────────────────────────────────────────────────────────

/**
 * RFC 9562/4122 UUID (any version 1-8), plus the nil UUID (all zeros) and the
 * max UUID (all f) that zod also accepts. This is an exact copy of the regex
 * zod/v4/core/regexes.js uses for z.uuid() with no version argument, so
 * isUuid(x) === z.uuid().safeParse(x).success for all x.
 *
 * Accepts mixed case; rejects surrounding whitespace and brace-wrapped forms.
 */
const UUID_PATTERN =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;

/** True when value is a valid RFC 9562/4122 UUID (any version). */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
