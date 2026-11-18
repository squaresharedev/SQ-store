/**
 * Auth constants that are safe to import from a Client Component.
 * Zod-free: contains only plain values and a pure predicate.
 * LoginForm imports from here so it does not pull in the full schema
 * (and therefore zod) through lib/validation/auth.ts.
 */

/** Mirrors the DB's format check and profiles_username_lower_idx. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

/**
 * Does this identifier want the email path or the handle path?
 *
 * An "@" is the whole test, and it is the RIGHT test: "@" cannot appear in a
 * handle, so anything containing one is an attempt at an email and should be
 * handed to Supabase to accept or reject as such. Whether it is a WELL-FORMED
 * email is not decided here.
 */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes("@");
}
