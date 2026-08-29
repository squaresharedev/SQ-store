/**
 * TYPO TOLERANCE, as two small primitives.
 *
 * Deliberately not a library. Everything here runs inside the same render as
 * the keystroke, over a few hundred short strings, so the whole budget is a
 * couple of milliseconds and the only operations that fit are ones that bail
 * out early. Both functions are pure and take no options, which is what lets
 * the ranker call them in a tight loop without thinking about cost.
 */

/** Past this, a "word" is not a word and no typo model applies to it. */
const MAX_WORD_LENGTH = 40;

/**
 * THE PREFILTER, and it is not an optimisation detail.
 *
 * Distance is the expensive thing here, and the palette runs it against every
 * cached product title on every keystroke: at snapshot scale that measured
 * 10ms per keystroke, which is a dropped frame while someone is typing.
 * Nearly all of that work is spent proving that two words with almost no
 * letters in common are far apart, which a 32-bit AND can prove instead.
 *
 * `charMask` is one bit per letter a-z, with everything else sharing bit 26.
 * Collapsing non-letters is deliberately CONSERVATIVE: a word containing any
 * digit or symbol looks like it contains all of them, so the filter passes
 * more than it must and never rejects a real match.
 */
export function charMask(word: string): number {
  let mask = 0;
  for (let i = 0; i < word.length; i++) {
    const offset = word.charCodeAt(i) - 97; // 'a'
    mask |= offset >= 0 && offset < 26 ? 1 << offset : 1 << 26;
  }
  return mask;
}

function popcount(value: number): number {
  let bits = value - ((value >> 1) & 0x55555555);
  bits = (bits & 0x33333333) + ((bits >> 2) & 0x33333333);
  bits = (bits + (bits >> 4)) & 0x0f0f0f0f;
  return (bits * 0x01010101) >> 24;
}

/**
 * How many distinct letters `a` has that `b` lacks. Each one costs at least
 * one edit, so this is a lower bound on the distance.
 *
 * ONE DIRECTION, and which one matters. This bound survives `b` being
 * TRUNCATED (a shorter `b` can only lack more), which is what lets the caller
 * use a single check to skip both the whole-word comparison and the
 * compare-against-the-word's-opening one. The reverse count is a valid floor
 * too, but only against the whole word, so it belongs at that call site.
 */
export function missingLetters(maskA: number, maskB: number): number {
  return popcount(maskA & ~maskB);
}

/** The tightest letters-only floor for comparing two WHOLE words. */
export function distanceFloor(maskA: number, maskB: number): number {
  return Math.max(missingLetters(maskA, maskB), missingLetters(maskB, maskA));
}

/** Scratch rows for the DP, reused across calls. Allocating three arrays per
 *  comparison was itself a measurable share of the cost. */
const ROW_A = new Int32Array(MAX_WORD_LENGTH + 1);
const ROW_B = new Int32Array(MAX_WORD_LENGTH + 1);
const ROW_C = new Int32Array(MAX_WORD_LENGTH + 1);

/**
 * Optimal string alignment distance (Levenshtein plus adjacent transposition),
 * cut off at `max`.
 *
 * The transposition case is the reason this is not plain Levenshtein: "colro"
 * and "recieve" are the single most common way a real person mistypes a word,
 * and Levenshtein charges two edits for it, which puts it outside any bound
 * tight enough to stay honest.
 *
 * Returns `max + 1` for anything further away than `max`, never the true
 * distance, because the callers only ever ask "is this within the bound".
 * The length pre-check makes the common case (a query token against a word
 * nothing like it) free.
 */
export function boundedDistance(a: string, b: string, max: number): number {
  const over = max + 1;
  if (a === b) return 0;
  if (max <= 0) return over;
  if (a.length > MAX_WORD_LENGTH || b.length > MAX_WORD_LENGTH) return over;
  if (Math.abs(a.length - b.length) > max) return over;
  if (a.length === 0) return b.length <= max ? b.length : over;
  if (b.length === 0) return a.length <= max ? a.length : over;

  // Three rows, reused: current, previous, and the one before it (which only
  // the transposition case reads).
  let twoBack = ROW_C;
  let prev = ROW_A;
  let row = ROW_B;
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    row[0] = i;
    let rowBest = i;
    const aPrev = a.charCodeAt(i - 1);
    const aTwoBack = i > 1 ? a.charCodeAt(i - 2) : -1;
    for (let j = 1; j <= b.length; j++) {
      const bPrev = b.charCodeAt(j - 1);
      const substitution = aPrev === bPrev ? 0 : 1;
      let cost = Math.min(
        prev[j]! + 1, // deletion
        row[j - 1]! + 1, // insertion
        prev[j - 1]! + substitution,
      );
      if (i > 1 && j > 1 && aPrev === b.charCodeAt(j - 2) && aTwoBack === bPrev) {
        cost = Math.min(cost, twoBack[j - 2]! + 1);
      }
      row[j] = cost;
      if (cost < rowBest) rowBest = cost;
    }
    // Every remaining edit can only add, so a row whose cheapest cell already
    // exceeds the bound can never come back under it.
    if (rowBest > max) return over;
    const spent = twoBack;
    twoBack = prev;
    prev = row;
    row = spent;
  }

  const distance = prev[b.length]!;
  return distance <= max ? distance : over;
}

/**
 * How many edits a token of this length is allowed to be wrong by.
 *
 * Short tokens get NOTHING, and that is the whole safety of the feature: at
 * one edit, "cat" reaches "cut", "car" and "can", so every three-letter query
 * would match half the index and the results would read as random. From four
 * characters up a typo is far likelier than a coincidence.
 *
 * The second edit waits until eight characters for the same reason, measured
 * rather than guessed: at two edits a six-letter word reaches genuinely
 * unrelated ones ("gutter" to "letter", "corners" to "orders"), and both of
 * those really did surface as top results while this was being tuned. Almost
 * nothing is lost by the tighter bound, because a transposition counts as ONE
 * edit here, which is what most double-looking typos actually are.
 */
export function maxEdits(length: number): number {
  if (length <= 3) return 0;
  if (length <= 7) return 1;
  return 2;
}

/**
 * Are the token's characters all present, in order, inside the word?
 *
 * The last-resort signal, for the mangling that edit distance gives up on:
 * dropped vowels ("bckgrnd"), heavy abbreviation ("dsplay"). It scores low
 * wherever it is used, because on its own it is weak evidence.
 *
 * Anchored on the first character, and only worth asking for tokens long
 * enough that the subsequence means something. Without the anchor, "aei"
 * matches almost any English phrase.
 */
export function isSubsequenceOf(token: string, word: string): boolean {
  if (token.length < 4 || word.length < token.length) return false;
  if (token[0] !== word[0]) return false;
  let at = 0;
  for (let i = 0; i < word.length && at < token.length; i++) {
    if (word[i] === token[at]) at++;
  }
  return at === token.length;
}
