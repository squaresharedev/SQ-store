/**
 * RANKING for universal search. Pure functions, no React / Supabase / Next —
 * unit-testable with no mocking, and cheap enough to run on every keystroke
 * over the whole local registry.
 *
 * Used three times:
 *   1. the LOCAL registry, which is matched entirely in the browser;
 *   2. the storefront designer's own "find a setting" field;
 *   3. ordering rows WITHIN a remote group, because Postgres `ilike` answers
 *      "does it match" and says nothing about how well.
 *
 * WHAT THIS SOLVES, and why it is not a substring search.
 *
 * The first version scored the WHOLE query as one needle against each term.
 * That is fine for "refund" and useless for the way people actually type,
 * which is a short sentence: "store bg colour" matched nothing at all, because
 * no label anywhere contains that string. Three things had to change together,
 * and none of them works without the others:
 *
 *   PER WORD. The query is split into tokens and each is matched separately,
 *   so a result can be assembled out of a label, a subtitle and a synonym at
 *   once. This is what makes a sentence findable.
 *
 *   COVERAGE FIRST. A result matching three of three words beats one matching
 *   two, however well it matched them. Without this, per-word matching is
 *   worse than the substring search it replaced: every entry containing the
 *   word "store" would tie for a query about the store's background.
 *
 *   TOLERANCE. Typos (`fuzzy.ts`), abbreviations and spelling (`vocabulary.ts`)
 *   are the difference between a search that answers and one that punishes.
 *
 * The scores below are a shape, not physics: what matters is the ORDER of the
 * constants and the gaps between them, which is what the tests pin down.
 */

import {
  boundedDistance,
  charMask,
  distanceFloor,
  isSubsequenceOf,
  maxEdits,
  missingLetters,
} from "@/lib/search/fuzzy";
import {
  fold,
  normalizeWords,
  prepareQuery,
  type PreparedQuery,
  type QueryToken,
} from "@/lib/search/vocabulary";

// ---------------------------------------------------------------------------
// The tier scale, kept as-is
// ---------------------------------------------------------------------------

/** 4 exact · 3 starts-with · 2 word-boundary · 1 contains · 0 no match. */
export type MatchScore = 0 | 1 | 2 | 3 | 4;

/**
 * The original single-needle tier scorer. Still exported and still exact: it
 * is the cheapest honest answer to "how well does this one string match this
 * one term", and callers outside the palette (and the tests that pin the tier
 * order) use it directly.
 */
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

// ---------------------------------------------------------------------------
// Per-token scoring
// ---------------------------------------------------------------------------

/** How a single token met a single term. Ordered, and the gaps are the point. */
const EXACT = 1;
const WORD_EXACT = 0.94;
const PREFIX = 0.9;
const WORD_PREFIX = 0.86;
/** One typo, then two. A single mistyped character stays above a mid-word
 *  substring hit; two drops below it, because by then coincidence is likely. */
const FUZZY_WORD = 0.8;
const FUZZY_PREFIX = 0.72;
const FUZZY_STEP = 0.15;
const CONTAINS = 0.55;
/** "cs" for "Canvas size". Above a bare substring, below anything word-shaped. */
const INITIALS = 0.6;
/** "bckgrnd". Weak evidence by construction, and priced accordingly. */
const SUBSEQUENCE = 0.32;

/** A hit on the FIRST term (the title) counts for more than one on a synonym.
 *  By convention every caller passes the display title first. */
const TITLE_WEIGHT = 1;
const OTHER_TERM_WEIGHT = 0.84;

/** Whole-query bonuses. Big, so an exact synonym ("log out", "store name")
 *  still wins outright the way it did under the old tier scale. */
const PHRASE_EXACT = 1.5;
const PHRASE_PREFIX = 0.5;
const PHRASE_CONTAINS = 0.3;

/** A soft token contributes, but never as much as a word that narrowed. */
const SOFT_CREDIT = 0.3;

/** A term, split once and remembered. */
type PreparedTerm = {
  /** Folded, canonically spelled, single-spaced. */
  text: string;
  words: readonly string[];
  /** Each word's letter set, so the typo pass can skip a hopeless pair. */
  masks: readonly number[];
  /** First letters, for the "cs" → "Canvas size" case. */
  initials: string;
};

/**
 * Terms are overwhelmingly the same strings on every keystroke (a static
 * registry, a snapshot that changes once a minute), so preparing them is
 * worth caching. Bounded and cleared wholesale rather than evicted one at a
 * time: this is a hot path and an LRU's bookkeeping would cost more than the
 * occasional rebuild it saves.
 */
const TERM_CACHE = new Map<string, PreparedTerm>();
const TERM_CACHE_LIMIT = 4000;

function prepareTerm(term: string): PreparedTerm {
  const cached = TERM_CACHE.get(term);
  if (cached) return cached;
  const words = normalizeWords(term);
  const prepared: PreparedTerm = {
    text: words.join(" "),
    words,
    masks: words.map(charMask),
    initials: words.map((word) => word[0]).join(""),
  };
  if (TERM_CACHE.size >= TERM_CACHE_LIMIT) TERM_CACHE.clear();
  TERM_CACHE.set(term, prepared);
  return prepared;
}

/**
 * One spelling of one token against one prepared term.
 *
 * `wordOnly` stops at the word-shaped tiers, refusing to match a fragment. It
 * is set for a variant the person did not type (see the note on
 * QueryToken.variants) and for filler words, which have no business dragging
 * a result in on a substring.
 *
 * `typos` is off for filler too, which is both right and cheap: correcting a
 * misspelled "the" changes no ranking, and skipping it removes most of the
 * per-keystroke work a typed sentence would otherwise cost.
 */
function variantScore(
  variant: string,
  mask: number,
  term: PreparedTerm,
  wordOnly: boolean,
  typos: boolean,
): number {
  if (!variant || !term.text) return 0;

  if (term.text === variant) return EXACT;
  if (term.words.includes(variant)) return WORD_EXACT;
  if (term.text.startsWith(variant)) return PREFIX;
  for (const word of term.words) {
    if (word.startsWith(variant)) return WORD_PREFIX;
  }

  let best = 0;
  // Three characters minimum, or every two-letter query lands inside some
  // longer word: "cs" is in "analyti-cs", which is not what anyone meant.
  if (!wordOnly && variant.length >= 3 && term.text.includes(variant)) {
    best = CONTAINS;
  }
  if (
    !wordOnly &&
    variant.length >= 2 &&
    term.words.length >= 2 &&
    term.initials.startsWith(variant)
  ) {
    best = Math.max(best, INITIALS);
  }

  const budget = typos ? maxEdits(variant.length) : 0;
  if (budget > 0) {
    for (let i = 0; i < term.words.length; i++) {
      const word = term.words[i]!;
      const wordMask = term.masks[i]!;
      // The letters alone already put this word out of reach, opening
      // included. Skipping here is what keeps the typo pass affordable over a
      // whole snapshot of product titles.
      if (missingLetters(mask, wordMask) > budget) continue;

      if (distanceFloor(mask, wordMask) <= budget) {
        const distance = boundedDistance(variant, word, budget);
        if (distance <= budget) {
          best = Math.max(best, FUZZY_WORD - FUZZY_STEP * distance);
        }
      }
      // A typo inside a word the person only typed the start of: "bacground"
      // against the keyword "background image". Literal tokens only, since
      // this is a fragment match wearing a fuzzy hat.
      if (!wordOnly && word.length > variant.length) {
        const head = boundedDistance(variant, word.slice(0, variant.length), budget);
        if (head <= budget) {
          best = Math.max(best, FUZZY_PREFIX - FUZZY_STEP * head);
        }
      }
      if (best >= FUZZY_WORD - FUZZY_STEP) break;
    }
  }

  if (best === 0 && !wordOnly) {
    for (const word of term.words) {
      if (isSubsequenceOf(variant, word)) return SUBSEQUENCE;
    }
  }
  return best;
}

/**
 * The token's best showing against one term, across all its spellings.
 *
 * A filler word is scored LITERALLY and cheaply: no expansions, no typo pass.
 * It cannot decide a result on its own, so paying for its alternatives buys
 * nothing, and there is one of them in most words of a typed sentence.
 */
function tokenScore(token: QueryToken, term: PreparedTerm): number {
  if (token.soft) {
    const literal = token.variants[0];
    return literal
      ? variantScore(literal.text, literal.mask, term, true, false)
      : 0;
  }
  let best = 0;
  for (const variant of token.variants) {
    const score =
      variantScore(variant.text, variant.mask, term, variant.derived, true) *
      variant.weight;
    if (score > best) best = score;
    if (best >= WORD_EXACT) break;
  }
  return best;
}

/** How well one candidate answered the whole query. */
export type TermsMatch = {
  /** Higher is better. Only comparable within one query. */
  score: number;
  /** How many of the query's REQUIRED words this candidate accounted for.
   *  Compared before `score`, always. */
  coverage: number;
  /** The term that produced the strongest single hit, so a caller can show
   *  WHY a result is in the list when the label alone does not explain it. */
  matchedTerm: string | null;
};

const NO_MATCH: TermsMatch = { score: 0, coverage: 0, matchedTerm: null };

/** See the note in matchPreparedQuery: one candidate's terms at a time. */
const SCRATCH_TERMS: PreparedTerm[] = [];
const SCRATCH_WEIGHTS: number[] = [];
const SCRATCH_SOURCES: string[] = [];

/**
 * Score one candidate's terms against a prepared query.
 *
 * Exported for callers that want the detail (the designer's setting field
 * shows the synonym that matched); `rankEntries` is the usual way in.
 */
export function matchPreparedQuery(
  terms: readonly string[],
  query: PreparedQuery,
): TermsMatch {
  if (query.tokens.length === 0 || terms.length === 0) return NO_MATCH;

  // Reused scratch, not fresh arrays: this runs once per candidate, and at
  // snapshot scale that is hundreds of throwaway allocations per keystroke.
  // Safe because nothing here yields, recurses or escapes the function.
  const prepared = SCRATCH_TERMS;
  const weights = SCRATCH_WEIGHTS;
  /** Back to the caller's array, which empty terms make non-contiguous. */
  const sources = SCRATCH_SOURCES;
  let count = 0;
  for (let i = 0; i < terms.length; i++) {
    const term = terms[i];
    if (!term) continue;
    prepared[count] = prepareTerm(term);
    weights[count] = i === 0 ? TITLE_WEIGHT : OTHER_TERM_WEIGHT;
    sources[count] = term;
    count++;
  }
  if (count === 0) return NO_MATCH;

  // The phrase bonus. A term that IS the query, or starts with it, is the
  // strongest signal there is and must not be diluted by being spread across
  // per-word scores.
  let bonus = 0;
  const multiWord = query.phrase.includes(" ");
  for (let i = 0; i < count; i++) {
    const text = prepared[i]!.text;
    if (!text) continue;
    const weight = weights[i]!;
    if (text === query.phrase) bonus = Math.max(bonus, PHRASE_EXACT * weight);
    else if (text.startsWith(query.phrase)) {
      bonus = Math.max(bonus, PHRASE_PREFIX * weight);
    } else if (multiWord && text.includes(query.phrase)) {
      bonus = Math.max(bonus, PHRASE_CONTAINS * weight);
    }
  }

  let score = 0;
  let coverage = 0;
  let bestHit = 0;
  let matchedTerm: string | null = null;

  for (const token of query.tokens) {
    let best = 0;
    let bestIndex = -1;
    for (let i = 0; i < count; i++) {
      const hit = tokenScore(token, prepared[i]!) * weights[i]!;
      if (hit > best) {
        best = hit;
        bestIndex = i;
      }
      if (best >= TITLE_WEIGHT) break;
    }
    if (token.soft) {
      score += best * SOFT_CREDIT;
      continue;
    }
    score += best;
    if (best > 0) {
      coverage++;
      if (best > bestHit) {
        bestHit = best;
        matchedTerm = bestIndex >= 0 ? (sources[bestIndex] ?? null) : null;
      }
    }
  }

  // Nothing required was found. A phrase bonus alone cannot happen (an exact
  // phrase implies its words matched), so this really is a miss.
  if (coverage === 0) return NO_MATCH;

  return { score: score + bonus, coverage, matchedTerm };
}

/** Match a raw query string. Prepares it first; prefer the prepared form when
 *  scoring many candidates against the same query. */
export function matchTerms(terms: readonly string[], needle: string): TermsMatch {
  return matchPreparedQuery(terms, prepareQuery(needle));
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export type RankedItem<T> = TermsMatch & { item: T };

/**
 * Rank candidates, best first, with the coverage rule applied.
 *
 * THE COVERAGE FLOOR is the one piece of policy here, and it is relative to
 * the best answer rather than to the query, so a query full of words nothing
 * in the index knows still returns the closest thing instead of nothing.
 *
 * Short queries demand the best coverage outright: with two words, "sold out"
 * has to mean both, and letting a one-word match through fills the list with
 * "Payments" (for "pay-OUT-s") under the row that actually answered. From
 * three words up, one word is forgiven, because a longer query is a sentence
 * and sentences contain words the index has no reason to know. That also
 * leaves room for the near miss that is often what was meant: "store bg
 * colour" answers Background first and still offers Accent colour underneath.
 */
export function rankDetailed<T>(
  items: readonly T[],
  needle: string,
  terms: (item: T) => readonly string[],
  limit: number,
): RankedItem<T>[] {
  if (limit <= 0) return [];
  const query = prepareQuery(needle);
  if (query.tokens.length === 0) return [];

  const scored: RankedItem<T>[] = [];
  let bestCoverage = 0;
  for (const item of items) {
    const match = matchPreparedQuery(terms(item), query);
    if (match.coverage === 0) continue;
    if (match.coverage > bestCoverage) bestCoverage = match.coverage;
    scored.push({ ...match, item });
  }

  const floor = bestCoverage >= 3 ? bestCoverage - 1 : bestCoverage;
  const kept = scored.filter((entry) => entry.coverage >= floor);
  // Stable by construction: `Array.prototype.sort` is stable in every ES2019+
  // runtime, so a curated registry order survives a tie.
  kept.sort((a, b) => b.coverage - a.coverage || b.score - a.score);
  return kept.slice(0, limit);
}

/**
 * Drop non-matches, order by how well they answered, and cap.
 *
 * The shape the callers have always used; `rankDetailed` is the same pass with
 * the scores left on.
 */
export function rankEntries<T>(
  items: readonly T[],
  needle: string,
  terms: (item: T) => readonly string[],
  limit: number,
): T[] {
  return rankDetailed(items, needle, terms, limit).map((entry) => entry.item);
}
