/**
 * Caret and selection helpers for the editors that type ON the canvas (a text
 * block's words, a masthead line). Both hold their text imperatively, so both
 * need the same two translations: the live selection as character offsets into
 * an element's plain text, and back again.
 *
 * Shared rather than copied so the two editors can never drift onto different
 * ideas of where character 7 is.
 */

/** A selection as character offsets into an element's plain text. */
export type TextRange = { start: number; end: number };

/** The selection inside `node`, or null when it lives somewhere else. */
export function readSelection(node: HTMLElement): TextRange | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const live = selection.getRangeAt(0);
  if (!node.contains(live.startContainer) || !node.contains(live.endContainer)) {
    return null;
  }
  const before = document.createRange();
  before.selectNodeContents(node);
  before.setEnd(live.startContainer, live.startOffset);
  const start = before.toString().length;
  return { start, end: start + live.toString().length };
}

/** Put the selection back, in the same character offsets. */
export function setSelection(node: HTMLElement, start: number, end: number): void {
  const from = positionAt(node, start);
  const to = positionAt(node, end);
  const live = document.createRange();
  live.setStart(from.node, from.offset);
  live.setEnd(to.node, to.offset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(live);
}

/** The DOM position a character offset names. */
export function positionAt(
  node: HTMLElement,
  offset: number,
): { node: Node; offset: number } {
  let remaining = Math.max(0, offset);
  let last: Text | null = null;
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    if (remaining <= text.data.length) return { node: text, offset: remaining };
    remaining -= text.data.length;
    last = text;
  }
  return last ? { node: last, offset: last.data.length } : { node, offset: 0 };
}

/**
 * The character offset in `node` that a screen point lands on, or null when
 * the point is nowhere near its text.
 *
 * Needed because the canvas cannot leave the browser to it: a press on the
 * board preventDefaults so a drag rubber-bands instead of selecting text,
 * which also means a double-click there never makes a selection of its own.
 */
export function offsetAtPoint(
  node: HTMLElement,
  x: number,
  y: number,
): number | null {
  const doc = node.ownerDocument;
  const legacy = doc as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = doc.caretPositionFromPoint?.(x, y);
  const container = position?.offsetNode ?? null;
  const offset = position?.offset ?? 0;
  const hit = container
    ? { container, offset }
    : (() => {
        const range = legacy.caretRangeFromPoint?.(x, y);
        return range ? { container: range.startContainer, offset: range.startOffset } : null;
      })();
  if (!hit || !node.contains(hit.container)) return null;
  const before = doc.createRange();
  before.selectNodeContents(node);
  before.setEnd(hit.container, hit.offset);
  return before.toString().length;
}

/** The word around a character offset — what a double-click would have
 *  selected. Collapsed when the point is not on a word character. */
export function wordRangeAt(text: string, offset: number): TextRange {
  const isWord = (char: string | undefined) =>
    char !== undefined && /[\p{L}\p{N}_'’-]/u.test(char);
  // A click just past the end of a word belongs to that word.
  const at = isWord(text[offset]) ? offset : offset - 1;
  if (!isWord(text[at])) return { start: offset, end: offset };
  let start = at;
  while (start > 0 && isWord(text[start - 1])) start -= 1;
  let end = at + 1;
  while (end < text.length && isWord(text[end])) end += 1;
  return { start, end };
}

/** Insert plain text at the caret, replacing whatever is selected. */
export function insertPlainText(value: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const live = selection.getRangeAt(0);
  live.deleteContents();
  const inserted = document.createTextNode(value);
  live.insertNode(inserted);
  live.setStartAfter(inserted);
  live.collapse(true);
  selection.removeAllRanges();
  selection.addRange(live);
}
