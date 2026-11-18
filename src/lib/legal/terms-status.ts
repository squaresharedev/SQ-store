// SERVER ONLY. Which Terms version applies right now, from terms_versions.

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTermsStatus, type TermsStatus } from "@/lib/legal/terms-versions";

// --- module-level row cache -------------------------------------------

type TermsRow = {
  version: string;
  planned_effective_at: string | null;
  effective_at: string | null;
};

/** How long the fetched terms_versions rows stay cached before a fresh read.
 *  Resolution against the current time still runs per-request (via the
 *  React-cached getTermsStatus below), so the switch-over instant is exact
 *  even as multiple requests arrive across the Worker's lifetime. */
const TERMS_ROWS_TTL_MS = 5 * 60 * 1000;

let cachedTermsRows: TermsRow[] | null = null;
let termsRowsExpiresAt = 0;

/** Reset the row cache. For tests that need a clean slate between cases. */
export function resetTermsRowsCache(): void {
  cachedTermsRows = null;
  termsRowsExpiresAt = 0;
}

/** Fetch and return the terms_versions rows, using the in-module cache when
 *  they are fresh. On a failed read, serves the previously cached rows if
 *  any exist; returns null only on the very first failure before any rows
 *  have been fetched successfully. */
async function fetchTermsRows(): Promise<TermsRow[] | null> {
  const now = Date.now();
  if (cachedTermsRows !== null && now < termsRowsExpiresAt) return cachedTermsRows;
  try {
    const { data, error } = await createAdminClient()
      .from("terms_versions")
      .select("version, planned_effective_at, effective_at");
    if (error || !data) return cachedTermsRows; // keep previous rows on failure
    cachedTermsRows = data;
    termsRowsExpiresAt = now + TERMS_ROWS_TTL_MS;
    return cachedTermsRows;
  } catch {
    return cachedTermsRows; // keep previous rows on failure
  }
}

// --- per-request resolution -------------------------------------------

/**
 * Null when the table cannot be read AND no previous rows are available.
 * Callers then ask nobody to agree to anything: a blip must not tell a
 * seller their Terms changed.
 *
 * The rows are module-cached for TERMS_ROWS_TTL_MS; resolution against
 * the current time runs on every request so the switch-over instant is exact.
 */
export const getTermsStatus = cache(async (): Promise<TermsStatus | null> => {
  const rows = await fetchTermsRows();
  if (!rows) return null;
  return resolveTermsStatus(rows, new Date());
});
