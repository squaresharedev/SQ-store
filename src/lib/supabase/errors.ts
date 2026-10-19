/** "No such table": Postgres' own code, and PostgREST's for a table missing
 *  from its schema cache. What a read sees when the migration that adds the
 *  table has not reached this database yet. */
export const MISSING_TABLE_CODES: readonly string[] = ["42P01", "PGRST205"];

/** Whether a Supabase error says the table does not exist (yet). */
export function isMissingTableError(error: { code?: string | null } | null | undefined): boolean {
  return Boolean(error?.code && MISSING_TABLE_CODES.includes(error.code));
}
