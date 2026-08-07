import { z } from "zod";
import { handle } from "@/lib/validation/inputs";

/**
 * Auth validation shared by the sign-in screen, the sign-up flow and the
 * settings handle field. Safe to import from a Client Component: it is pure
 * schema with no server dependency, so the browser can pre-empt an obviously
 * bad handle while the server actions still re-parse everything.
 */

/** Mirrors the DB's format check and profiles_username_lower_idx. */
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 30;

/**
 * Handles nobody may claim. These read as the product, the platform, or a route
 * on it, so an account holding one can impersonate us or make a link ambiguous.
 * The list is deliberately short: it covers what we actually route on or sign
 * messages as, rather than trying to be a dictionary of every risky word.
 *
 * Not a security boundary on its own (nothing grants privilege by handle), but
 * a handle is public and quoted back to other users, so squatting `support` is
 * a phishing head start we can decline to give away for free.
 */
export const RESERVED_USERNAMES: readonly string[] = [
  "admin",
  "administrator",
  "api",
  "auth",
  "billing",
  "checkout",
  "dashboard",
  "help",
  "login",
  "logout",
  "moderator",
  "orders",
  "owner",
  "products",
  "root",
  "security",
  "settings",
  "signin",
  "signup",
  "squareshare",
  "storefront",
  "support",
  "system",
  "team",
];

/**
 * Canonical form of a handle: trimmed and lowercased. Comparison folds case at
 * every layer (the unique index, the resolver, this), so normalizing on the way
 * in only ensures the stored value matches what those comparisons see.
 *
 * Normalization NEVER rescues an invalid handle. `usernameSchema` still has the
 * final say, exactly like `normalizeHostname` and `hostname`.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export const usernameSchema = z.strictObject({
  username: handle("A username").refine(
    (value) => !RESERVED_USERNAMES.includes(value),
    { error: "That username is reserved. Pick another." },
  ),
});

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
