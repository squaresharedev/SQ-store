/**
 * Words for a share card's big type. Pure, so the rules are unit tested.
 */

/** A headline line reads best around this many characters: each line is then
 *  set to the full width, so fewer, longer lines would only be smaller. */
const HEADLINE_LINE_CHARS = 9;

/** Words this short do not end a headline ("with a", "and", "de"): cut off
 *  there, they read as a sentence that stopped. Any language, by length. */
const DANGLING_WORD_CHARS = 3;

/**
 * A product's title as a headline of at most `maxLines` lines and `budget`
 * characters: the leading words that fit (a long title keeps its first ones,
 * which are its name), without a short word left dangling at the end, split
 * into lines of even length. The full title is printed small elsewhere.
 */
export function headlineLines(title: string, maxLines: number, budget: number): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const kept: string[] = [words[0]];
  let length = words[0].length;
  for (const word of words.slice(1)) {
    if (length + 1 + word.length > budget) break;
    kept.push(word);
    length += 1 + word.length;
  }
  while (kept.length > 1 && kept[kept.length - 1].length <= DANGLING_WORD_CHARS) kept.pop();

  const lines = Math.max(
    1,
    Math.min(maxLines, kept.length, Math.ceil(kept.join(" ").length / HEADLINE_LINE_CHARS)),
  );
  return evenSplit(kept, lines);
}

/** `words` in `lines` consecutive groups, the longest group as short as it
 *  can be. A few words at most, so every split is simply tried. */
function evenSplit(words: string[], lines: number): string[] {
  let best: string[] = [words.join(" ")];
  let bestLongest = Infinity;
  const walk = (start: number, left: number, acc: string[]) => {
    if (left === 1) {
      const all = [...acc, words.slice(start).join(" ")];
      const longest = Math.max(...all.map((line) => line.length));
      if (longest < bestLongest) {
        best = all;
        bestLongest = longest;
      }
      return;
    }
    for (let end = start + 1; end <= words.length - left + 1; end += 1) {
      walk(end, left - 1, [...acc, words.slice(start, end).join(" ")]);
    }
  };
  walk(0, lines, []);
  return best;
}

/** `phrase` repeated until it is at least `chars` long: text to run right
 *  round a ring with no gap where it ends. */
export function repeatToLength(phrase: string, chars: number): string {
  if (!phrase) return "";
  return phrase.repeat(Math.max(1, Math.ceil(chars / phrase.length)));
}
