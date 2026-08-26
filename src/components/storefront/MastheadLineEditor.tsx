"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { HeaderLine } from "@/types/storefront";
import {
  clampHeaderText,
  headerLineAllowsNewlines,
} from "@/lib/storefront/header-text";
import {
  readSelection,
  setSelection,
  type TextRange,
} from "@/lib/storefront/text-selection";
import { cn } from "@/lib/utils";

/**
 * A masthead line, typed where it reads: double-clicking the store name or the
 * bio on the canvas turns that line into this, with the caret already in the
 * words the seller aimed at.
 *
 * Same contract as InlineTextEditor, minus the runs — a header line is a plain
 * string, so the DOM holds text and nothing else. REACT STILL DOES NOT OWN
 * THAT TEXT: the element renders childless and the words are written
 * imperatively, because repainting children under the caret collapses the
 * selection on every keystroke. A change from OUTSIDE (an undo) no longer
 * matches what was last painted, and only then is the line repainted.
 *
 * The line keeps the tag it reads as (h2 / p) and the classes and styles the
 * masthead gave it, so entering edit mode changes nothing about how it looks.
 */
export function MastheadLineEditor({
  line,
  value,
  initialRange = null,
  className,
  style,
  onChange,
  onToggleFormat,
  onDone,
}: {
  line: HeaderLine;
  /** The stored line. Written to the DOM on mount, and again whenever it
   *  arrives differing from what this editor last wrote. */
  value: string;
  /** Where the caret (or the double-clicked word) was in the line that was
   *  clicked. Null puts the caret at the end. */
  initialRange?: TextRange | null;
  className: string;
  style: CSSProperties;
  /** Cleaned and capped before it ever reaches here. */
  onChange: (value: string) => void;
  /** Ctrl+B / I / U: the line has its own bold/italic/underline flags, and the
   *  window-level shortcut deliberately stays out of any field. */
  onToggleFormat: (format: "bold" | "italic" | "underline") => void;
  /** Escape, or focus leaving the line. */
  onDone: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  // A callback ref, so the one ref serves whichever tag the line renders as.
  const attach = useCallback((node: HTMLElement | null) => {
    ref.current = node;
  }, []);
  // What was last WRITTEN to the DOM: props that differ came from outside.
  const painted = useRef<string | null>(null);
  const multiline = headerLineAllowsNewlines(line);

  function paint(text: string) {
    const node = ref.current;
    if (!node) return;
    node.replaceChildren(document.createTextNode(text));
    // A newline at the very end has no line of its own until something follows
    // it, and a caret cannot land on a line that is not there. The filler <br>
    // every browser uses for exactly this is what gives it one; readPlainText
    // reads it back as nothing.
    if (text.endsWith("\n")) node.append(document.createElement("br"));
    node.dataset.empty = String(text.length === 0);
    painted.current = text;
  }

  /** Read the DOM back, cleaned and capped, and report it. */
  function syncFromDom() {
    const node = ref.current;
    if (!node) return;
    const raw = readPlainText(node);
    const text = clampHeaderText(line, raw);
    if (text !== raw) {
      // A paste over the cap (or one carrying control characters): the DOM has
      // to be corrected, so the caret is put back at the end of what survived.
      paint(text);
      setSelection(node, text.length, text.length);
    } else {
      node.dataset.empty = String(text.length === 0);
      painted.current = text;
    }
    onChange(text);
  }

  // First paint: the words, the focus, and the selection the click left behind.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    paint(value);
    node.focus({ preventScroll: true });
    const start = Math.min(initialRange?.start ?? value.length, value.length);
    const end = Math.min(initialRange?.end ?? value.length, value.length);
    setSelection(node, start, end);
    // Mount only: the line seeds the DOM here, and every later change comes
    // through the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A change that did NOT come from typing here — an undo, a template applied.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || painted.current === null || painted.current === value) return;
    paint(value);
    setSelection(node, value.length, value.length);
  }, [value]);

  /**
   * Write `insert` over the selection (or at the caret), through the MODEL:
   * read the line back, splice, repaint, put the caret after what landed.
   *
   * The long way round on purpose. Inserted straight into the DOM, a newline
   * typed at the END of the text has nowhere the browser will let a caret sit,
   * and the next keystroke jumps back in front of it — paint's filler <br> is
   * what makes that position exist.
   */
  function replaceSelection(insert: string) {
    const node = ref.current;
    if (!node) return;
    const text = readPlainText(node);
    const at = readSelection(node) ?? { start: text.length, end: text.length };
    const next = clampHeaderText(
      line,
      `${text.slice(0, at.start)}${insert}${text.slice(at.end)}`,
    );
    if (next === text) return; // Nothing survived the cap.
    paint(next);
    const caret = Math.min(at.start + insert.length, next.length);
    setSelection(node, caret, caret);
    onChange(next);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    // Arrows and Enter belong to the caret: the canvas would nudge or select
    // with them.
    event.stopPropagation();

    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "b" || key === "i" || key === "u") {
        event.preventDefault();
        onToggleFormat(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
      }
      // Everything else modified (select all, copy, paste, undo) is the
      // browser's, and the field handles it natively.
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      // The name is one line, so Enter there means "done".
      if (!multiline) {
        ref.current?.blur();
        return;
      }
      // The bio takes a real newline rather than the <div>/<br> structure a
      // contenteditable builds on its own: the stored value is a plain string,
      // and pre-wrap renders "\n" identically.
      replaceSelection("\n");
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      ref.current?.blur();
    }
  }

  /** Keep a pasted document from arriving as markup on a plain-text line — and
   *  a pasted paragraph from arriving as line breaks on the one-line name. */
  function handlePaste(event: React.ClipboardEvent<HTMLElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text/plain");
    if (!pasted) return;
    replaceSelection(multiline ? pasted : pasted.replace(/\s*\n\s*/g, " "));
  }

  const attributes = {
    // React renders NO children into this element on purpose (see above).
    contentEditable: true,
    suppressContentEditableWarning: true,
    role: "textbox",
    "aria-multiline": multiline,
    "aria-label": line === "name" ? "Store name" : "Store bio",
    spellCheck: false,
    onInput: syncFromDom,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    onBlur: onDone,
    // The canvas frame starts a marquee from pointerdown and clears the
    // selection on click; inside the words, both belong to the caret.
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
    onDoubleClick: (event: React.MouseEvent) => event.stopPropagation(),
    className: cn(
      className,
      // pre-wrap, not the masthead's pre-line: runs of spaces have to survive
      // being typed, or the caret lands behind the text.
      "cursor-text select-text whitespace-pre-wrap rounded-sm outline-none ring-2 ring-ring ring-offset-1",
      // The caret needs somewhere to sit in a line that has been emptied, and
      // the line needs to say what it is while it has no words of its own.
      line === "name"
        ? "data-[empty=true]:before:content-['Store_name']"
        : "data-[empty=true]:before:content-['Add_a_short_bio']",
      "data-[empty=true]:before:pointer-events-none data-[empty=true]:before:opacity-40",
    ),
    style,
  };

  // The tag the line reads as, unchanged by the edit: the store name is a
  // heading whether or not there is a caret in it.
  return line === "name" ? (
    <h2 ref={attach} {...attributes} />
  ) : (
    <p ref={attach} {...attributes} />
  );
}

/**
 * The editor's plain text.
 *
 * Line breaks are "\n" CHARACTERS here, never elements — that is how they are
 * stored, and it is what paint writes. A <br> therefore only ever means one of
 * two fillers: the one paint parks after a trailing newline, or one the browser
 * left behind, and neither is a break of its own.
 */
function readPlainText(node: HTMLElement): string {
  let text = "";
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += (child as Text).data;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as HTMLElement;
    if (element.tagName === "BR") {
      // A <br> in the middle, with a line that is not already broken, is a
      // break the browser made on some path this editor does not own.
      if (element !== node.lastChild && !text.endsWith("\n")) text += "\n";
      continue;
    }
    text += readPlainText(element);
    // A contenteditable wraps pasted paragraphs in blocks; each one that is not
    // the last starts a new line.
    if (isBlockElement(element) && element !== node.lastChild) text += "\n";
  }
  return text;
}

function isBlockElement(element: HTMLElement): boolean {
  return ["DIV", "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6"].includes(
    element.tagName,
  );
}
