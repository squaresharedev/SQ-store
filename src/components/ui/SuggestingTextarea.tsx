"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type TextareaHTMLAttributes,
} from "react";
import { infoTextClass, kbdClass, quietLinkClass } from "@/components/ui/control-styles";
import { cn } from "@/lib/utils";

/** How long typing must pause before the next words are asked for. */
const SUGGEST_PAUSE_MS = 500;

/** The field's styles the mirror copies, so the grey words sit exactly where
 *  the next letter would. */
const MIRRORED = [
  "boxSizing",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textTransform",
  "textIndent",
  "wordSpacing",
  "tabSize",
  "paddingTop",
  "paddingLeft",
  "paddingBottom",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "overflowWrap",
  "wordBreak",
] as const;

/** Words on offer, and the exact text they follow. */
type Offer = { after: string; text: string };

export type SuggestingTextareaLabels = {
  /** While the field has focus and nothing is on offer ("AI suggests the next words as you type."). */
  idle: string;
  /** After the Tab key, while words are on offer ("adds the grey text. Esc hides it."). */
  offered: string;
  /** The Tab key as a button, for touch and pointer ("Add the suggested words"). */
  accept: string;
  /** Said to a screen reader before the words ("Suggestion:"). */
  announce: string;
  /** The way out ("Turn off"). */
  turnOff: string;
};

/**
 * A textarea that offers the next words in grey after the cursor, the way a
 * code editor does. Tab adds them, Esc hides them, and typing the same letters
 * keeps the rest on offer; typing anything else, or moving the cursor away
 * from the end, makes them go. Words are asked for only after a pause, with
 * the cursor at the end, and an answer that comes back after the text changed
 * is dropped: the suggestion never writes over the person.
 *
 * Added words go in through the browser's own editing (insertText), so Ctrl+Z
 * takes them back out like anything typed. Tab is only taken while words are
 * on offer; otherwise it moves focus as always. The line under the field says
 * what Tab does, holds the Tab key as a button for touch, and the way out.
 *
 * The grey words are drawn in a mirror under a transparent field: the same
 * box, font and wrapping, the person's text invisible in it and the offer
 * after it. With `suggest` null it is a plain textarea.
 */
export function SuggestingTextarea({
  value,
  onChange,
  suggest,
  labels,
  onTurnOff,
  className,
  onKeyDown,
  onScroll,
  "aria-describedby": describedBy,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  /** The words to offer after `text` (the cursor is at its end), or null. */
  suggest: ((text: string) => Promise<string | null>) | null;
  labels: SuggestingTextareaLabels;
  onTurnOff?: () => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Bumped whenever an answer on its way stops being wanted.
  const asked = useRef(0);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [focused, setFocused] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  const hintId = useId();

  // The words in grey now: only for this exact text, at its end, in focus.
  const shown = suggest !== null && focused && atEnd && offer?.after === value ? offer.text : "";
  const visible = shown !== "";

  useEffect(() => {
    const pending = timer;
    return () => clearTimeout(pending.current);
  }, []);

  // The mirror follows the field's box, and its scroll, on every change.
  useLayoutEffect(() => {
    const area = field.current;
    const ghost = mirror.current;
    if (!area || !ghost) return;
    const copy = () => {
      const style = getComputedStyle(area);
      for (const key of MIRRORED) ghost.style[key] = style[key];
      // A scrollbar narrows the field's text; the mirror has none, so it
      // gives the same room up on the right.
      const scrollbar =
        area.offsetWidth - area.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
      ghost.style.paddingRight = `${parseFloat(style.paddingRight) + scrollbar}px`;
      ghost.style.width = `${area.offsetWidth}px`;
      ghost.style.height = `${area.offsetHeight}px`;
      ghost.scrollTop = area.scrollTop;
    };
    copy();
    // A resize by its handle between changes; without ResizeObserver (jsdom)
    // the mirror follows on each change only.
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(copy);
    observer.observe(area);
    return () => observer.disconnect();
  }, [value, visible]);

  function forget() {
    clearTimeout(timer.current);
    asked.current += 1;
  }

  function ask(text: string) {
    forget();
    if (!suggest) return;
    timer.current = setTimeout(() => {
      const area = field.current;
      if (!area || area.value !== text || area.selectionStart !== text.length || area.selectionEnd !== text.length) return;
      const id = asked.current;
      void suggest(text)
        .catch(() => null)
        .then((words) => {
          if (id !== asked.current || field.current?.value !== text) return;
          setOffer(words ? { after: text, text: words } : null);
        });
    }, SUGGEST_PAUSE_MS);
  }

  function change(next: string) {
    // Typing what was on offer keeps the rest of it on offer.
    const typed = offer && offer.after === value && next.startsWith(value) ? next.slice(value.length) : "";
    if (offer && typed && typed.length < offer.text.length && offer.text.startsWith(typed)) {
      forget();
      setOffer({ after: next, text: offer.text.slice(typed.length) });
    } else {
      setOffer(null);
      ask(next);
    }
    onChange(next);
  }

  function accept() {
    const area = field.current;
    if (!visible || !area) return;
    area.focus();
    area.setSelectionRange(value.length, value.length);
    // The browser's own insert keeps its undo history: Ctrl+Z takes the words
    // back out. Where it is missing, the words go in as a plain change.
    const inserted = typeof document.execCommand === "function" && document.execCommand("insertText", false, shown);
    if (!inserted) change(value + shown);
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    onKeyDown?.(event);
    if (!visible || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      accept();
    } else if (event.key === "Escape") {
      // Hidden, not closed around it: Esc in a dialog would otherwise close it.
      event.preventDefault();
      event.stopPropagation();
      forget();
      setOffer(null);
    }
  }

  function trackCaret() {
    const area = field.current;
    if (area) setAtEnd(area.selectionStart === area.selectionEnd && area.selectionEnd === area.value.length);
  }

  // Focus anywhere in the field or its line (the Tab key, "Turn off") counts
  // as being in the field, so the line's buttons stay while they are used.
  const leave = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setFocused(false);
      clearTimeout(timer.current);
    }
  };

  const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

  return (
    <div onFocus={() => setFocused(true)} onBlur={leave} data-suggesting-textarea={suggest ? "" : undefined}>
      <div className="relative rounded-sm bg-background">
        <div
          ref={mirror}
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 overflow-hidden whitespace-pre-wrap border-solid border-transparent text-transparent"
        >
          <span className="invisible">{value}</span>
          {visible && (
            <span className="text-muted-foreground" data-next-words="">
              {shown}
            </span>
          )}
        </div>
        <textarea
          {...props}
          ref={field}
          value={value}
          onChange={(event) => change(event.target.value)}
          onKeyDown={keyDown}
          onSelect={trackCaret}
          onScroll={(event) => {
            if (mirror.current) mirror.current.scrollTop = event.currentTarget.scrollTop;
            onScroll?.(event);
          }}
          aria-describedby={[describedBy, suggest ? hintId : null].filter(Boolean).join(" ") || undefined}
          className={cn(className, "relative bg-transparent")}
        />
      </div>
      {suggest && (
        <div className={cn(infoTextClass, "mt-1 flex min-h-6 items-center gap-2")}>
          <p id={hintId} className="flex items-center gap-1.5" data-suggest-hint={visible ? "offered" : "idle"}>
            {focused &&
              (visible ? (
                <>
                  {/* Named by its own word, so the line reads "Tab adds the
                      grey text" as the field's description too. */}
                  <button
                    type="button"
                    className={cn(kbdClass, "cursor-pointer")}
                    title={labels.accept}
                    onPointerDown={keepFocus}
                    onMouseDown={keepFocus}
                    onClick={accept}
                  >
                    Tab
                  </button>
                  <span>{labels.offered}</span>
                </>
              ) : (
                labels.idle
              ))}
          </p>
          {focused && onTurnOff && (
            <button
              type="button"
              className={cn(quietLinkClass, "ml-auto")}
              onPointerDown={keepFocus}
              onMouseDown={keepFocus}
              onClick={onTurnOff}
            >
              {labels.turnOff}
            </button>
          )}
          <span className="sr-only" aria-live="polite">
            {visible ? `${labels.announce} ${shown}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}
