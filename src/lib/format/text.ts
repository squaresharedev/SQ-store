/**
 * The first `max` characters of a line, never ending on half an emoji: a
 * surrogate pair cut in two prints as a broken glyph in a share card and is
 * not valid JSON for a search engine to read.
 */
export function clipText(text: string, max: number): string {
  return text.slice(0, max).replace(/[\ud800-\udbff]$/, "");
}
