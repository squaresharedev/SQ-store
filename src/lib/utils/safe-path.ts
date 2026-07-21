/**
 * Reduce untrusted input to a SAME-ORIGIN path, or fall back.
 *
 * Used for every post-auth `?next=` redirect and for in-app notification links.
 * Isomorphic on purpose (no server-only imports) — the notification list is a
 * Client Component and must apply the identical rule.
 *
 * WHY NOT a prefix check. The obvious guard is:
 *
 *   value.startsWith("/") && !value.startsWith("//")
 *
 * which is bypassable, because a browser does not read the string the way that
 * check does. Tabs, newlines and carriage returns are STRIPPED during URL
 * parsing, and a backslash is treated as a slash in the authority position:
 *
 *   "/\t/evil.com"  -> passes the check -> browser parses "//evil.com"
 *   "/\n/evil.com"  -> passes the check -> browser parses "//evil.com"
 *   "/\\evil.com"   -> passes the check -> browser parses "//evil.com"
 *
 * All three are protocol-relative URLs: the victim lands on evil.com carrying
 * whatever trust the redirect implied. So instead of pattern-matching the raw
 * string, resolve it with the SAME parser the browser uses and require the
 * origin to be unchanged. Anything that escapes the origin is rejected outright
 * rather than patched up.
 */

/** Never resolvable as a real origin, so any escape is unambiguous. */
const PLACEHOLDER_ORIGIN = "https://internal.invalid";

/** Characters a URL parser drops or that terminate the authority early. */
const URL_IGNORED_CHARS = /[\u0000-\u001F\u007F]/g;

export function safeInternalPath(raw: unknown, fallback = "/"): string {
  if (typeof raw !== "string" || raw.length === 0) return fallback;

  // Strip what the parser would strip, BEFORE deciding — otherwise the string
  // we validate is not the string the browser navigates to.
  const cleaned = raw.replace(URL_IGNORED_CHARS, "");

  // Must be root-relative. Rejects "https://evil.com" and "javascript:..."
  // before parsing, so a scheme can never survive.
  if (!cleaned.startsWith("/")) return fallback;

  let url: URL;
  try {
    url = new URL(cleaned, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }

  // The single authoritative check: did it stay on our origin? Catches
  // "//host", "/\host", and any normalization trick that reaches an authority.
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;

  // Rebuild from parsed parts so the result is normalized (e.g. "/a/../b"
  // collapses) and carries nothing from the raw input.
  return `${url.pathname}${url.search}${url.hash}`;
}
