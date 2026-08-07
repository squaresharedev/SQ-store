import { z } from "zod";
import { singleLineText } from "@/lib/validation/inputs";
import {
  MAX_QUERY_LENGTH,
  MIN_REMOTE_QUERY_LENGTH,
  REMOTE_TYPES,
  isRemoteSearchType,
  type RemoteSearchType,
} from "@/lib/search/types";

/**
 * Input gate for GET /api/search.
 *
 * The query is ordinary user prose, so it goes through `singleLineText` like
 * every other free-text field: trimmed, length-bounded, control characters
 * rejected. It is then escaped for `ilike` at the query site
 * (`@/lib/supabase/ilike`), which is a separate concern — that escaping is
 * about matching correctness, this is about what we accept at all.
 *
 * The lower bound is real, not cosmetic: a 1-character query matches most of a
 * catalogue and costs a scan to answer with nothing useful. The palette does
 * not call this endpoint below MIN_REMOTE_QUERY_LENGTH either, so a request
 * that trips this bound is a client bug or a script.
 */
export const searchQuerySchema = z.object({
  q: singleLineText({
    label: "Search query",
    min: MIN_REMOTE_QUERY_LENGTH,
    max: MAX_QUERY_LENGTH,
  }),
});

export type SearchQueryInput = z.infer<typeof searchQuerySchema>;

/**
 * Parse the optional `types` narrowing param.
 *
 * Deliberately NOT a Zod field: this is a fixed enum allowlist, not user text.
 * Modelling the comma-separated form in the schema would mean reaching for a
 * bare string primitive, which the validation hygiene test rightly refuses —
 * and there is nothing to validate here beyond "is it one of five known
 * literals". Unknown entries are dropped rather than rejected, so a stale
 * client asking for a type we removed still gets the rest of its results.
 */
export function parseSearchTypes(raw: string | null): RemoteSearchType[] {
  if (!raw) return [...REMOTE_TYPES];
  const requested = raw.split(",").map((part) => part.trim()).filter(isRemoteSearchType);
  return requested.length > 0 ? requested : [...REMOTE_TYPES];
}
