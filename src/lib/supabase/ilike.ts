/**
 * The longest term any `ilike` search sends to Postgres.
 *
 * A BACKSTOP, not the UX limit. Surfaces cap tighter where the number means
 * something (universal search rejects anything over MAX_QUERY_LENGTH long
 * before it reaches here), but EVERY ilike path in the app funnels through
 * `escapeIlike`, so this is the one place a future search box cannot forget to
 * bound. Sized above the longest term that could legitimately match a row: a
 * product title maxes at 200 characters and an email address at 254.
 *
 * What it stops is not injection — PostgREST parameterises the value, which is
 * the whole reason this module is about matching and not about SQL. It stops a
 * megabyte of pattern arriving in a query string and being evaluated per row
 * across a scan, on surfaces whose term comes straight from a URL.
 */
export const MAX_ILIKE_TERM_LENGTH = 256;

/**
 * Escape the wildcard characters (`%`, `_`) and the escape character itself
 * (`\`) in a user-supplied `ilike` search term, and bound its length.
 *
 * Without the escaping, a search for "50%" matches everything after the 5, and
 * "a_b" matches "axb" — surprising, and on a large table a leading `%` pattern
 * the user didn't intend is a needless sequential scan. PostgREST parameterises
 * the value, so this is about CORRECTNESS of the match, not SQL injection; the
 * value never reaches the database as SQL text.
 *
 * Callers still wrap the escaped term in their own `%...%` for a contains
 * match: those wildcards are the caller's intent, not the user's input.
 */
export function escapeIlike(term: string): string {
  // Truncate BEFORE escaping, never after. Slicing escaped output can cut a
  // `\%` in half and leave a trailing lone backslash, which is an invalid
  // escape sequence — Postgres errors on it rather than simply matching
  // nothing, so the "safety" clamp would itself break the query.
  return term
    .slice(0, MAX_ILIKE_TERM_LENGTH)
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}
