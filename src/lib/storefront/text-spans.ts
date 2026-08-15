import type { TextBlock, TextSpan, TextStyle } from "@/types/storefront";

/**
 * PART-OF-THE-TEXT FORMATTING for text blocks.
 *
 * A text block carries block-level formatting (bold/italic/underline/color)
 * that applies to all of it, plus an optional list of SPANS: half-open
 * `[start, end)` character ranges that override those defaults. Two colours in
 * one sentence is a span; a whole heading in red is still just `block.color`.
 *
 * Every operation here goes through a per-character expansion. The text is
 * capped at TEXT_MAX_LENGTH (300), so an array per character is nothing, and
 * it makes splitting, merging and normalising fall out for free instead of
 * being interval arithmetic nobody can review. What comes back out is always
 * sorted, non-overlapping, gap-free-by-construction and free of runs that say
 * nothing — so two different edit paths cannot store the same result twice.
 */

/** The keys a span may override. */
const STYLE_KEYS = ["color", "bold", "italic", "underline"] as const;
type StyleKey = (typeof STYLE_KEYS)[number];

/** A style with nothing set: the character simply follows its block. */
export function isPlainStyle(style: TextStyle): boolean {
  return STYLE_KEYS.every((key) => style[key] === undefined);
}

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return STYLE_KEYS.every((key) => a[key] === b[key]);
}

/** The style half of a span, without its bounds. */
function styleOf(span: TextSpan): TextStyle {
  const style: TextStyle = {};
  for (const key of STYLE_KEYS) {
    const value = span[key];
    if (value !== undefined) (style as Record<string, unknown>)[key] = value;
  }
  return style;
}

/**
 * Spans -> one style per character. Out-of-range and inverted bounds are
 * clamped away rather than rejected: this runs on stored data, and a config
 * that somehow holds a span past the end of its text should render, not throw.
 */
function toChars(spans: readonly TextSpan[] | undefined, length: number): TextStyle[] {
  const chars: TextStyle[] = Array.from({ length }, () => ({}));
  for (const span of spans ?? []) {
    const start = Math.max(0, Math.min(length, Math.trunc(span.start)));
    const end = Math.max(0, Math.min(length, Math.trunc(span.end)));
    const style = styleOf(span);
    for (let i = start; i < end; i += 1) {
      chars[i] = { ...chars[i], ...style };
    }
  }
  return chars;
}

/** Per-character styles -> the shortest list of spans that describes them. */
function toSpans(chars: readonly TextStyle[]): TextSpan[] {
  const spans: TextSpan[] = [];
  let index = 0;
  while (index < chars.length) {
    const style = chars[index];
    let end = index + 1;
    while (end < chars.length && sameStyle(chars[end], style)) end += 1;
    // Runs that override nothing are the default, and storing them would let
    // the same appearance have two representations.
    if (!isPlainStyle(style)) spans.push({ start: index, end, ...style });
    index = end;
  }
  return spans;
}

/** Sort, clamp, merge and drop no-op spans. Safe on anything. */
export function normalizeSpans(
  spans: readonly TextSpan[] | undefined,
  textLength: number,
): TextSpan[] {
  return toSpans(toChars(spans, textLength));
}

/** What to change over a range. `null` clears the override, sending those
 *  characters back to whatever the block says. */
export type TextFormatPatch = Partial<
  Record<StyleKey, string | boolean | null>
>;

/** Apply a patch to `[start, end)` and hand back the whole normalized list. */
export function applyFormatToRange(
  spans: readonly TextSpan[] | undefined,
  textLength: number,
  range: { start: number; end: number },
  patch: TextFormatPatch,
): TextSpan[] {
  const chars = toChars(spans, textLength);
  const start = Math.max(0, Math.min(textLength, Math.trunc(range.start)));
  const end = Math.max(0, Math.min(textLength, Math.trunc(range.end)));
  for (let i = start; i < end; i += 1) {
    const next: TextStyle = { ...chars[i] };
    for (const key of STYLE_KEYS) {
      if (!(key in patch)) continue;
      const value = patch[key];
      if (value === null || value === undefined) delete next[key];
      else (next as Record<string, unknown>)[key] = value;
    }
    chars[i] = next;
  }
  return toSpans(chars);
}

/** One run of characters that share a style, ready to render. */
export type TextSegment = { text: string; style: TextStyle };

/** Split text into styled runs. Always returns at least one segment, so a
 *  renderer never has to special-case empty text. */
export function segmentText(
  text: string,
  spans: readonly TextSpan[] | undefined,
): TextSegment[] {
  if (!spans || spans.length === 0) return [{ text, style: {} }];
  const chars = toChars(spans, text.length);
  const segments: TextSegment[] = [];
  let index = 0;
  while (index < text.length) {
    const style = chars[index];
    let end = index + 1;
    while (end < text.length && sameStyle(chars[end], style)) end += 1;
    segments.push({ text: text.slice(index, end), style });
    index = end;
  }
  return segments.length > 0 ? segments : [{ text, style: {} }];
}

/** The block's own value for a formatting key — what a character with no
 *  override of its own renders as. */
function blockDefault(block: TextBlock, key: StyleKey): boolean {
  return key === "color" ? false : block[key] === true;
}

/**
 * Is EVERY character in the range already carrying this format? That is what
 * decides which way Ctrl+B goes: a fully bold selection un-bolds, a mixed or
 * plain one goes bold. An empty range answers with the block's own state, so
 * the caret-only case toggles the whole block the same way.
 */
export function rangeHasFormat(
  block: TextBlock,
  range: { start: number; end: number },
  key: Exclude<StyleKey, "color">,
): boolean {
  const chars = toChars(block.spans, block.text.length);
  if (range.end <= range.start) return blockDefault(block, key);
  for (let i = range.start; i < Math.min(range.end, chars.length); i += 1) {
    if ((chars[i][key] ?? blockDefault(block, key)) !== true) return false;
  }
  return true;
}

/**
 * The colour every character in the range renders in, or null when they do not
 * agree (or simply follow the block). Lets the colour picker show the
 * selection's real colour instead of the block's.
 */
export function rangeColor(
  block: TextBlock,
  range: { start: number; end: number },
): string | null {
  if (range.end <= range.start) return null;
  const chars = toChars(block.spans, block.text.length);
  let color: string | undefined;
  for (let i = range.start; i < Math.min(range.end, chars.length); i += 1) {
    const at = chars[i].color;
    if (i === range.start) color = at;
    else if (at !== color) return null;
  }
  return color ?? null;
}

/**
 * Toggling a format over a range writes the OPPOSITE of what is there now —
 * but when that already matches the block, the override is dropped instead of
 * stored. A block that is bold everywhere holds no spans at all, however the
 * seller got there.
 */
export function toggleFormatPatch(
  block: TextBlock,
  range: { start: number; end: number },
  key: Exclude<StyleKey, "color">,
): TextFormatPatch {
  const next = !rangeHasFormat(block, range, key);
  return { [key]: next === blockDefault(block, key) ? null : next };
}
