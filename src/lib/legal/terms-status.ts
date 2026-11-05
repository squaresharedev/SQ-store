// SERVER ONLY. Which Terms version applies right now, from terms_versions.

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTermsStatus, type TermsStatus } from "@/lib/legal/terms-versions";

/**
 * Null when the table cannot be read. Callers then ask nobody to agree to
 * anything: a blip must not tell a seller their Terms changed.
 */
export const getTermsStatus = cache(async (): Promise<TermsStatus | null> => {
  try {
    const { data, error } = await createAdminClient()
      .from("terms_versions")
      .select("version, planned_effective_at, effective_at");
    if (error || !data) return null;
    return resolveTermsStatus(data, new Date());
  } catch {
    return null;
  }
});
