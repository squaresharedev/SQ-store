/**
 * Escape the wildcard characters (`%`, `_`) and the escape character itself
 * (`\`) in a user-supplied `ilike` search term.
 *
 * Without this, a search for "50%" matches everything after the 5, and "a_b"
 * matches "axb" — surprising, and on a large table a leading `%` pattern the
 * user didn't intend is a needless sequential scan. PostgREST parameterises
 * the value, so this is about CORRECTNESS of the match, not SQL injection;
 * the value never reaches the database as SQL text.
 *
 * Callers still wrap the escaped term in their own `%...%` for a contains
 * match: those wildcards are the caller's intent, not the user's input.
 */
export function escapeIlike(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
