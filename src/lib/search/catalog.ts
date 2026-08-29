/**
 * A SEARCHABLE CATALOGUE: the one shape an index entry has, and the one pass
 * that turns a query into grouped, ranked rows.
 *
 * WHY THIS EXISTS. There are two search surfaces (the universal palette and
 * the storefront editor's own field) and they were each hand-rolling the same
 * four steps: decide what strings an entry is matched on, hide what the role
 * cannot use, rank, then group. Two implementations of "what strings" is the
 * one that actually bites: the palette matched a storefront setting on
 * `[label, subtitle, ...keywords]` and the editor on `[label, ...keywords]`,
 * so the SAME setting ranked differently depending on where you typed, while
 * both files carried a comment promising they could never disagree.
 *
 * Now they cannot, by construction: {@link entryTerms} is the only answer to
 * that question, and every surface goes through {@link searchCatalog}.
 *
 * WHAT STAYS PER SURFACE is presentation and payload. The palette's rows carry
 * an href and render a breadcrumb; the editor's carry a target it acts on
 * in place and render a group name. That is what `payload` is for, and why
 * this module knows nothing about either.
 *
 * Adding a surface is: describe its entries, name its sections, call
 * searchCatalog. Adding a KIND of thing to an existing surface is one more
 * entry in that surface's list.
 */

import { rankDetailed } from "@/lib/search/rank";
import { can, type TeamAction, type TeamRole } from "@/lib/team/permissions";

/**
 * One searchable thing, whatever it turns out to be: a page, a settings
 * field, a control inside a panel, an object on a canvas.
 *
 * `payload` is what the surface does with a hit and is never looked at here.
 */
export type SearchEntry<T> = {
  /** Unique within its catalogue. Becomes a DOM id, so aria-activedescendant
   *  depends on it being unambiguous. */
  id: string;
  /** The row's name, and the term weighted highest. */
  title: string;
  /** Second line: a breadcrumb, a kind, a status. Searched as well as shown. */
  subtitle?: string;
  /**
   * What else someone might call it. These no longer have to be exhaustive:
   * spelling, typos and abbreviations are the ranker's job (see
   * lib/search/vocabulary). Write down only what no rule could derive — other
   * names for the thing, and how someone describes it when they cannot name
   * it at all.
   */
  keywords?: readonly string[];
  /** Which group the row renders under, and the key its section is found by. */
  section: string;
  /** Hidden entirely when the active role lacks this. Cosmetic: the route and
   *  the server action re-check regardless. */
  permission?: TeamAction;
  payload: T;
};

/** A matched entry, with why it matched. */
export type SearchHit<T> = {
  entry: SearchEntry<T>;
  /** Only comparable within one query. */
  score: number;
  /** How many of the query's required words this entry accounted for. */
  coverage: number;
  /** The term that produced the strongest hit, so a surface can say WHY a row
   *  is in the list when its own title does not explain it. */
  matchedTerm: string | null;
};

export type SearchSection<T> = {
  key: string;
  label: string;
  hits: SearchHit<T>[];
};

/** A catalogue's sections, in the order they are shown when nothing about the
 *  query says otherwise. */
export type SectionSpec = { key: string; label: string };

/**
 * THE terms an entry is matched on. Title first, because the ranker weights
 * the first term highest and every surface puts the display name there.
 *
 * Memoised against the entry object: the palette's entries are module
 * constants matched on every keystroke, and rebuilding these arrays is pure
 * waste. Entries the editor rebuilds per render simply miss the cache, which
 * costs one array.
 */
const TERMS = new WeakMap<object, string[]>();

export function entryTerms<T>(entry: SearchEntry<T>): string[] {
  const cached = TERMS.get(entry);
  if (cached) return cached;
  const terms = [
    entry.title,
    ...(entry.subtitle ? [entry.subtitle] : []),
    ...(entry.keywords ?? []),
  ];
  TERMS.set(entry, terms);
  return terms;
}

/**
 * Permission gate. A viewer must not be offered "New product" only to be
 * refused by the page they land on. A null role fails closed.
 */
export function allowedFor<T>(
  entries: readonly SearchEntry<T>[],
  role: TeamRole | null | undefined,
): SearchEntry<T>[] {
  return entries.filter(
    (entry) => !entry.permission || (role ? can(role, entry.permission) : false),
  );
}

/**
 * Match a catalogue and group the hits.
 *
 * SECTIONS ARE ORDERED BY WHAT ANSWERED, not by the order they are declared
 * in, with that order as the tiebreak. A fixed shelf order is right for a
 * resting list and wrong for a query: the first row is what Enter activates,
 * and "Pages" sitting above "Settings" by convention once put the Orders page
 * above Corner roundness for "corners".
 *
 * An entry whose section is not declared is dropped rather than guessed at,
 * which turns a typo in a section key into a missing group during development
 * rather than an unlabelled one in front of a seller.
 */
export function searchCatalog<T>(
  entries: readonly SearchEntry<T>[],
  query: string,
  options: {
    sections: readonly SectionSpec[];
    /** Cap across ALL sections combined, matching what the surface can show. */
    limit: number;
    role?: TeamRole | null;
  },
): SearchSection<T>[] {
  const pool = allowedFor(entries, options.role);
  const ranked = rankDetailed(pool, query, entryTerms, options.limit);
  if (ranked.length === 0) return [];

  const bySection = new Map<string, SearchHit<T>[]>();
  for (const { item, score, coverage, matchedTerm } of ranked) {
    const hits = bySection.get(item.section);
    const hit = { entry: item, score, coverage, matchedTerm };
    if (hits) hits.push(hit);
    else bySection.set(item.section, [hit]);
  }

  return options.sections
    .map((section, index) => ({
      ...section,
      hits: bySection.get(section.key) ?? [],
      index,
    }))
    .filter((section) => section.hits.length > 0)
    .sort((a, b) => {
      // Ranked the way the rows inside are, coverage before score, so the
      // leading section is genuinely the one holding the best row.
      const lead = a.hits[0]!;
      const rival = b.hits[0]!;
      return (
        rival.coverage - lead.coverage ||
        rival.score - lead.score ||
        a.index - b.index
      );
    })
    .map(({ key, label, hits }) => ({ key, label, hits }));
}
