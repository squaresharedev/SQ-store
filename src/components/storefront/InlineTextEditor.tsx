"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  TEXT_MAX_LENGTH,
  type TextBlock,
  type TextSpan,
  type TextStyle,
} from "@/types/storefront";
import {
  applyFormatToRange,
  segmentText,
  toggleFormatPatch,
} from "@/lib/storefront/text-spans";
import { cn } from "@/lib/utils";

/**
 * A text block's words, typed where they live — including the part-by-part
 * formatting, so two colours in one sentence are edited the way they read.
 *
 * REACT DOES NOT OWN THE CONTENT. The element is rendered childless and its
 * runs are written imperatively; every keystroke flows OUT through onChange.
 * Rendering the text back into a focused contenteditable would re-create the
 * nodes under the caret on every keystroke, which collapses the selection.
 *
 * The DOM and the model stay in step in both directions:
 *  - TYPING: the DOM moved first, so it is read back (text plus the runs it
 *    carries) and reported up. No repaint, so the caret never moves. Runs
 *    stretch and merge as characters are added or removed inside them, which
 *    is exactly what the browser already does to the nodes holding them.
 *  - A CHANGE FROM OUTSIDE (a colour picked in the panel, a format shortcut,
 *    an undo): the incoming block no longer matches what was last painted, so
 *    the runs are repainted and the selection restored by character offset.
 *
 * Formatting is never the browser's: Ctrl+B in a contenteditable would wrap
 * the selection in markup this editor does not read back, so the shortcuts are
 * intercepted and applied to the model instead.
 *
 * Gestures are stopped here too: the grid cell underneath starts a block drag
 * on pointerdown, moves the block on arrow keys, and toggles the selection on
 * click, all of which belong to the caret while typing.
 */

/** Marks a run this editor wrote. Only these carry formatting on read-back, so
 *  anything else that reaches the DOM contributes its text and nothing more. */
const RUN_STYLE_KEYS = ["color", "bold", "italic", "underline"] as const;

/** The selection, kept visible while the seller reaches into the colour panel
 *  and the browser has stopped painting it. */
const PENDING_CLASS = "rounded-[2px] bg-ring/30";

export type TextRange = { start: number; end: number };
export type InlineFormatKey = "bold" | "italic" | "underline";

/** What produced a change, so the designer can give each kind its own undo
 *  step: a burst of keystrokes collapses into one, but the format or colour
 *  applied afterwards is a separate thing to take back. */
export type TextEditSource = "typing" | "format";

export function InlineTextEditor({
  block,
  className,
  style,
  selectAll,
  onChange,
  onToggleBlockFormat,
  onRangeChange,
  onDone,
}: {
  block: TextBlock;
  className: string;
  style: React.CSSProperties;
  /** Start with everything selected, so the first keystroke replaces the
   *  placeholder a freshly inserted block was given. */
  selectAll: boolean;
  /** Text and/or runs changed. Both travel together: a keystroke can move the
   *  runs, and a run can only be read against the text it applies to. */
  onChange: (text: string, spans: TextSpan[], source: TextEditSource) => void;
  /** Ctrl+B / I / U with no selection: the command is about the whole block,
   *  which has its own flags for exactly that. */
  onToggleBlockFormat: (key: InlineFormatKey) => void;
  /** The live selection in character offsets, so the colour picker knows
   *  whether it is colouring a few words or the whole block. */
  onRangeChange: (range: TextRange | null) => void;
  /** Escape, or focus leaving for anywhere but the design panel. */
  onDone: () => void;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  // What was last WRITTEN to the DOM. Props that differ came from outside and
  // have to be painted; props that match are this editor's own echo.
  const painted = useRef<{ text: string; spans: TextSpan[] } | null>(null);
  // The last selection inside the editor, in character offsets. Survives the
  // trip to the panel and back.
  const range = useRef<TextRange | null>(null);
  // True while the selection is drawn by us rather than by the browser
  // (because focus is in the panel).
  const pending = useRef(false);
  // Where the last press landed, so a blur can tell "reached for the panel"
  // from "left the editor".
  const pressedInPanel = useRef(false);
  // Latest callback, for the document listener that subscribes once. Written
  // in an effect (never during render) the way the canvas's other
  // subscribe-once listeners read their handlers.
  const report = useRef(onRangeChange);
  useEffect(() => {
    report.current = onRangeChange;
  });

  function repaint(text: string, spans: TextSpan[], highlight: TextRange | null) {
    const node = ref.current;
    if (!node) return;
    writeRuns(node, text, spans, highlight);
    node.dataset.empty = String(text.length === 0);
    painted.current = { text, spans };
  }

  /** Remember (and report) where the caret or selection is now. */
  function captureRange() {
    const node = ref.current;
    if (!node || pending.current) return;
    const next = readSelection(node);
    range.current = next;
    report.current(next);
  }

  /** Read the DOM back and report it. Capped at the same length the stored
   *  config allows, which also covers a paste that lands over the limit. */
  function syncFromDom() {
    const node = ref.current;
    if (!node) return;
    const read = readRuns(node);
    if (read.text.length > TEXT_MAX_LENGTH) {
      const text = read.text.slice(0, TEXT_MAX_LENGTH);
      const spans = clampSpans(read.spans, text.length);
      repaint(text, spans, null);
      setSelection(node, text.length, text.length);
      captureRange();
      onChange(text, spans, "typing");
      return;
    }
    node.dataset.empty = String(read.text.length === 0);
    painted.current = read;
    onChange(read.text, read.spans, "typing");
  }

  /** Bold / italic / underline over the selection, or over the whole block
   *  when there is only a caret. */
  function toggleFormat(key: InlineFormatKey) {
    const active = range.current;
    if (!active || active.start === active.end) {
      onToggleBlockFormat(key);
      return;
    }
    onChange(
      block.text,
      applyFormatToRange(
        block.spans,
        block.text.length,
        active,
        toggleFormatPatch(block, active, key),
      ),
      "format",
    );
  }

  // First paint: the runs, the caret, and the initial selection.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    repaint(block.text, block.spans ?? [], null);
    node.focus({ preventScroll: true });
    if (selectAll && block.text.length > 0) setSelection(node, 0, block.text.length);
    else setSelection(node, block.text.length, block.text.length);
    captureRange();
    // Mount only: the block seeds the DOM here, and every later change comes
    // through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A change that did NOT come from typing here — a colour applied from the
  // panel, a format shortcut, an undo. Repaint, and put the selection back.
  useLayoutEffect(() => {
    const node = ref.current;
    const last = painted.current;
    if (!node || !last) return;
    const spans = block.spans ?? [];
    if (last.text === block.text && sameSpans(last.spans, spans)) return;
    const keep = range.current;
    repaint(block.text, spans, pending.current ? keep : null);
    if (keep && !pending.current) {
      setSelection(
        node,
        Math.min(keep.start, block.text.length),
        Math.min(keep.end, block.text.length),
      );
    }
  }, [block.text, block.spans]);

  // The selection is a document-level thing: it moves under arrow keys, drags,
  // double-clicks and Select All alike, and only this event sees all of them.
  useEffect(() => {
    function onSelectionChange() {
      const node = ref.current;
      if (!node || document.activeElement !== node || pending.current) return;
      const next = readSelection(node);
      range.current = next;
      report.current(next);
    }
    function onPointerDown(event: Event) {
      const target = event.target as HTMLElement | null;
      pressedInPanel.current = Boolean(target?.closest("[data-design-panel]"));
    }
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLParagraphElement>) {
    // Arrows, Enter and Space are the caret's here — the grid cell would move
    // the block, and the tile would toggle its own selection.
    event.stopPropagation();

    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "b" || key === "i" || key === "u") {
        event.preventDefault();
        toggleFormat(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
        return;
      }
      // Everything else modified (select all, copy, paste, undo) is the
      // browser's, and the field handles it natively.
      return;
    }

    if (event.key === "Enter") {
      // A real newline, rather than the <div>/<br> structure a contenteditable
      // builds on its own: the text is a plain string, and pre-wrap renders
      // "\n" identically.
      event.preventDefault();
      insertPlainText("\n");
      syncFromDom();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      // Hand the keyboard back to the TILE, not to nothing: the canvas keys
      // (arrows to nudge, Delete to remove) only reach the grid from there.
      // Focusing it blurs this element, which is what ends the edit — so
      // Escape and clicking away still take the same path out.
      const tile = ref.current?.closest<HTMLElement>("[data-block-tile]");
      if (tile) tile.focus();
      else ref.current?.blur();
    }
  }

  /** Keep a pasted document from arriving as markup on a plain-text block. */
  function handlePaste(event: React.ClipboardEvent<HTMLParagraphElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text/plain");
    if (!pasted) return;
    insertPlainText(pasted);
    syncFromDom();
  }

  function handleBlur() {
    // Reaching for the colour picker is still part of the edit: keep the block
    // in typing mode and draw the selection ourselves, since the browser stops
    // painting it the moment focus leaves.
    const active = range.current;
    if (pressedInPanel.current && active && active.start !== active.end) {
      pending.current = true;
      repaint(block.text, block.spans ?? [], active);
      return;
    }
    onDone();
  }

  function handleFocus() {
    if (!pending.current) return;
    pending.current = false;
    const keep = range.current;
    repaint(block.text, block.spans ?? [], null);
    if (keep && ref.current) setSelection(ref.current, keep.start, keep.end);
  }

  return (
    <p
      ref={ref}
      // React renders NO children into this element on purpose (see above).
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Block text"
      spellCheck={false}
      onInput={syncFromDom}
      onKeyDown={handleKeyDown}
      onKeyUp={captureRange}
      onMouseUp={captureRange}
      onPaste={handlePaste}
      onFocus={handleFocus}
      onBlur={handleBlur}
      // The cell underneath drags the block from pointerdown and selects it on
      // click; inside the words, both belong to the caret.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      className={cn(
        className,
        // pre-wrap, not the container's pre-line: runs of spaces have to
        // survive being typed, or the caret lands behind the text.
        "cursor-text select-text whitespace-pre-wrap outline-none",
        // The caret needs somewhere to sit in an empty block, and the block
        // needs to say what it is while it has no words of its own.
        "data-[empty=true]:before:pointer-events-none data-[empty=true]:before:opacity-40 data-[empty=true]:before:content-['Type_here']",
      )}
      style={style}
    />
  );
}

/* ---------------------------------------------------------------- DOM <-> model */

/** Write the model's runs into the editor. Each run is one <span> carrying its
 *  formatting BOTH as inline style (to look right) and as data attributes (the
 *  only thing read back), so a stray element can never pose as a run. */
function writeRuns(
  node: HTMLElement,
  text: string,
  spans: readonly TextSpan[],
  highlight: TextRange | null,
): void {
  const fragment = document.createDocumentFragment();
  for (const run of highlightedSegments(text, spans, highlight)) {
    if (!run.text) continue;
    const element = document.createElement("span");
    element.dataset.run = "";
    if (run.style.color !== undefined) {
      element.dataset.color = run.style.color;
      element.style.color = run.style.color;
    }
    if (run.style.bold !== undefined) {
      element.dataset.bold = run.style.bold ? "1" : "0";
      element.style.fontWeight = run.style.bold ? "700" : "400";
    }
    if (run.style.italic !== undefined) {
      element.dataset.italic = run.style.italic ? "1" : "0";
      element.style.fontStyle = run.style.italic ? "italic" : "normal";
    }
    if (run.style.underline !== undefined) {
      element.dataset.underline = run.style.underline ? "1" : "0";
      element.style.textDecorationLine = run.style.underline
        ? "underline"
        : "none";
    }
    if (run.pending) element.className = PENDING_CLASS;
    element.append(document.createTextNode(run.text));
    fragment.append(element);
  }
  node.replaceChildren(fragment);
}

type PaintedRun = { text: string; style: TextStyle; pending: boolean };

/** The model's runs, split again wherever the drawn selection starts or ends. */
function highlightedSegments(
  text: string,
  spans: readonly TextSpan[],
  highlight: TextRange | null,
): PaintedRun[] {
  const base = segmentText(text, spans);
  if (!highlight || highlight.end <= highlight.start) {
    return base.map((segment) => ({ ...segment, pending: false }));
  }
  const runs: PaintedRun[] = [];
  let offset = 0;
  for (const segment of base) {
    const start = offset;
    const end = offset + segment.text.length;
    offset = end;
    const from = Math.max(start, highlight.start);
    const to = Math.min(end, highlight.end);
    if (from >= to) {
      runs.push({ ...segment, pending: false });
      continue;
    }
    if (from > start) {
      runs.push({
        text: text.slice(start, from),
        style: segment.style,
        pending: false,
      });
    }
    runs.push({ text: text.slice(from, to), style: segment.style, pending: true });
    if (to < end) {
      runs.push({ text: text.slice(to, end), style: segment.style, pending: false });
    }
  }
  return runs;
}

/** Read the editor back as plain text plus the runs it carries. Only this
 *  editor's own data attributes are trusted; every other element contributes
 *  its text alone, so markup that slipped in cannot become formatting. */
function readRuns(node: HTMLElement): { text: string; spans: TextSpan[] } {
  let text = "";
  const spans: TextSpan[] = [];

  function walk(parent: Node, inherited: TextStyle) {
    for (const child of Array.from(parent.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const value = (child as Text).data;
        if (!value) continue;
        const start = text.length;
        text += value;
        if (RUN_STYLE_KEYS.some((key) => inherited[key] !== undefined)) {
          spans.push({ start, end: text.length, ...inherited });
        }
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const element = child as HTMLElement;
      if (element.tagName === "BR") {
        // The browser parks a filler <br> at the end of an editable; a real
        // line break is a "\n" in the text (see the Enter handler).
        if (element !== node.lastChild) text += "\n";
        continue;
      }
      walk(element, runStyle(element, inherited));
    }
  }

  walk(node, {});
  return { text, spans };
}

/** The formatting an element declares, over whatever it inherited. */
function runStyle(element: HTMLElement, inherited: TextStyle): TextStyle {
  if (element.dataset.run === undefined) return inherited;
  const style: TextStyle = { ...inherited };
  const { color, bold, italic, underline } = element.dataset;
  if (color !== undefined) style.color = color;
  if (bold !== undefined) style.bold = bold === "1";
  if (italic !== undefined) style.italic = italic === "1";
  if (underline !== undefined) style.underline = underline === "1";
  return style;
}

function clampSpans(spans: readonly TextSpan[], length: number): TextSpan[] {
  return spans
    .map((span) => ({
      ...span,
      start: Math.min(span.start, length),
      end: Math.min(span.end, length),
    }))
    .filter((span) => span.start < span.end);
}

function sameSpans(a: readonly TextSpan[], b: readonly TextSpan[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ------------------------------------------------------------------- selection */

/** The selection as character offsets into the editor's plain text. */
function readSelection(node: HTMLElement): TextRange | null {
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

function setSelection(node: HTMLElement, start: number, end: number): void {
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
function positionAt(
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

/** Insert plain text at the caret, replacing whatever is selected. */
function insertPlainText(value: string): void {
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
