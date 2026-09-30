"use client";

import { useCallback, useLayoutEffect, useRef, type CSSProperties } from "react";
import { clampPlainText } from "@/lib/storefront/header-text";
import { readSelection, setSelection, type TextRange } from "@/lib/storefront/text-selection";
import { cn } from "@/lib/utils";

/**
 * ONE LINE (OR A FEW) OF PLAIN TEXT, TYPED WHERE IT READS. The storefront's
 * masthead uses it for the store name and bio, and the checkout artboards for
 * the words a seller writes on those pages, so the canvas has one way of
 * turning a line of text into a caret.
 *
 * REACT DOES NOT OWN THE TEXT: the element renders childless and the words are
 * written imperatively, because repainting children under the caret collapses
 * the selection on every keystroke. A change from OUTSIDE (an undo, the same
 * field typed into in the panel) no longer matches what was last painted, and
 * only then is the line repainted.
 *
 * The element keeps the tag and the classes it reads as, so entering edit mode
 * changes nothing about how it looks; the caret is what says it is live. An
 * emptied line shows its placeholder (`data-placeholder`), which is also how a
 * line that falls back to default copy says what it would read as.
 */
export function PlainTextEditor({
  value,
  as: Tag = "p",
  multiline,
  maxLength,
  ariaLabel,
  placeholder,
  initialRange = null,
  className,
  style,
  onChange,
  onToggleFormat,
  onDone,
}: {
  /** The stored text. Written to the DOM on mount, and again whenever it
   *  arrives differing from what this editor last wrote. */
  value: string;
  as?: "h1" | "h2" | "p" | "blockquote";
  /** Whether Enter makes a new line (prose) or finishes (a heading). */
  multiline: boolean;
  maxLength: number;
  ariaLabel: string;
  /** Shown while the line is empty. */
  placeholder: string;
  /** Where the caret (or the double/triple-clicked word) was in the line that
   *  was clicked. Null puts the caret at the end. */
  initialRange?: TextRange | null;
  className?: string;
  style?: CSSProperties;
  /** Cleaned and capped before it ever reaches here. */
  onChange: (value: string) => void;
  /** Ctrl+B / I / U, for a line that carries its own format flags. Absent =
   *  the keys do nothing here (never the browser's rich-text formatting). */
  onToggleFormat?: (format: "bold" | "italic" | "underline") => void;
  /** Escape, Enter on a one-line field, or focus leaving the line. */
  onDone: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  // A callback ref, so the one ref serves whichever tag the line renders as.
  const attach = useCallback((node: HTMLElement | null) => {
    ref.current = node;
  }, []);
  // What was last WRITTEN to the DOM: props that differ came from outside.
  const painted = useRef<string | null>(null);

  const clamp = (raw: string) => clampPlainText(raw, multiline, maxLength);

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
    const text = clamp(raw);
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

  // A change that did NOT come from typing here: an undo, the panel's field.
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
   * and the next keystroke jumps back in front of it; paint's filler <br> is
   * what makes that position exist.
   */
  function replaceSelection(insert: string) {
    const node = ref.current;
    if (!node) return;
    const text = readPlainText(node);
    const at = readSelection(node) ?? { start: text.length, end: text.length };
    const next = clamp(`${text.slice(0, at.start)}${insert}${text.slice(at.end)}`);
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
        // Never the browser's own rich-text formatting: the stored value is a
        // plain string, and markup typed into it would be read back as text.
        event.preventDefault();
        onToggleFormat?.(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
      }
      // Everything else modified (select all, copy, paste, undo) is the
      // browser's, and the field handles it natively.
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      // A one-line field has nothing to break, so Enter means "done".
      if (!multiline) {
        ref.current?.blur();
        return;
      }
      // Prose takes a real newline rather than the <div>/<br> structure a
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

  /** Keep a pasted document from arriving as markup on a plain-text line, and
   *  a pasted paragraph from arriving as line breaks on a one-line field. */
  function handlePaste(event: React.ClipboardEvent<HTMLElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text/plain");
    if (!pasted) return;
    replaceSelection(multiline ? pasted : pasted.replace(/\s*\n\s*/g, " "));
  }

  return (
    <Tag
      ref={attach}
      // React renders NO children into this element on purpose (see above).
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline={multiline}
      aria-label={ariaLabel}
      spellCheck={false}
      data-placeholder={placeholder}
      onInput={syncFromDom}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onBlur={onDone}
      // The canvas frame starts a marquee from pointerdown and clears the
      // selection on click; inside the words, both belong to the caret.
      onPointerDown={(event: React.PointerEvent) => event.stopPropagation()}
      onClick={(event: React.MouseEvent) => event.stopPropagation()}
      onDoubleClick={(event: React.MouseEvent) => event.stopPropagation()}
      className={cn(
        className,
        // pre-wrap, not pre-line: runs of spaces have to survive being typed,
        // or the caret lands behind the text. No ring: the caret is what says
        // a line is live.
        "cursor-text select-text whitespace-pre-wrap rounded-sm outline-none",
        // The caret needs somewhere to sit in a line that has been emptied,
        // and the line needs to say what it is while it has no words.
        "data-[empty=true]:before:content-[attr(data-placeholder)]",
        "data-[empty=true]:before:pointer-events-none data-[empty=true]:before:opacity-40",
      )}
      style={style}
    />
  );
}

/**
 * The editor's plain text.
 *
 * Line breaks are "\n" CHARACTERS here, never elements: that is how they are
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
  return ["DIV", "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6"].includes(element.tagName);
}
