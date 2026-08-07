/**
 * RANKING for universal search. Pure functions, no React / Supabase / Next —
 * unit-testable with no mocking, and cheap enough to run on every keystroke
 * over the whole local registry.
 *
 * Used twice:
 *   1. the LOCAL registry, which is matched entirely in the browser;
 *   2. ordering rows WITHIN a remote group, because Postgres `ilike` answers
 *      "does it match" and says nothing about how well.
 *
 * The tiers exist because "contains" alone puts "Refund policy" above "Refunds"
 * for the query "refund", which reads as broken. Ranking by where the match
 * lands fixes that without needing a similarity score.
 */

/** 4 exact · 3 starts-with · 2 word-boundary · 1 contains · 0 no match. */
export type MatchScore = 0 | 1 | 2 | 3 | 4;

/**
 * Case- and accent-fold for comparison. NFD + stripping combining marks means
 * "cafe" finds "Café", which matters because the DB side cannot do this
 * (`unaccent` is not enabled) and the local registry may as well be kinder.
 *
 * `\p{Diacritic}` rather than a U+0300–U+036F character class on purpose: a
 * literal range would put raw combining characters into this source file, where
 * they are invisible and one careless edit from being mangled.
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

export function scoreMatch(haystack: string, needle: string): MatchScore {
  const hay = fold(haystack);
  const term = fold(needle);
  if (!term || !hay) return 0;
  if (hay === term) return 4;
  if (hay.startsWith(term)) return 3;
  // Any word after the first starting with the term: "Danger zone" for "zone".
  // Split on whitespace AND the separators that show up in labels and slugs.
  if (hay.split(/[\s/_.-]+/).some((word) => word.startsWith(term))) return 2;
  if (hay.includes(term)) return 1;
  return 0;
}

/** Best score across several strings — a title plus its synonyms. */
export function scoreTerms(terms: readonly string[], needle: string): MatchScore {
  let best: MatchScore = 0;
  for (const term of terms) {
    const score = scoreMatch(term, needle);
    if (score > best) best = score;
    if (best === 4) break;
  }
  return best;
}

/**
 * Drop non-matches, order by score descending, keep the input order within a
 * tier (so a curated registry order survives), and cap.
 *
 * `Array.prototype.sort` is stable in every engine that ships an ES2019+
 * runtime, which is what makes "keep the input order within a tier" free.
 */
export function rankEntries<T>(
  items: readonly T[],
  needle: string,
  terms: (item: T) => readonly string[],
  limit: number,
): T[] {
  const scored: { item: T; score: MatchScore }[] = [];
  for (const item of items) {
    const score = scoreTerms(terms(item), needle);
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((entry) => entry.item);
}
