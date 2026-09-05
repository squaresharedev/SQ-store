"use client";

import { useEffect, useRef } from "react";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  headerStyleValue,
  type HeaderLine,
  type StorefrontHeader,
  type StorefrontTheme,
} from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { headerThemeColors } from "@/lib/theme/color-target";
import { fontPresentation } from "@/lib/theme/storefront-fonts";
import {
  offsetAtPoint,
  wordRangeAt,
  type TextRange,
} from "@/lib/storefront/text-selection";
import { cn } from "@/lib/utils";
import { TEXT_ALIGN_CLASSES, textSizeStyle } from "./config-maps";
import { MastheadLineEditor } from "./MastheadLineEditor";

/**
 * The storefront masthead (store name + bio) rendered above the grid — shared
 * by the designer canvas and the list-card preview so they can never drift.
 * Plain text nodes only (schema caps + strips control chars). Each line takes
 * its own color and size when the seller set one, and otherwise inherits: the
 * name from the theme accent (exactly like text-block headings), the bio from
 * the default ink. Renders nothing when hidden or empty. `compact` scales it
 * down for small previews.
 *
 * In the DESIGNER (and only there) each line is also a target: `onSelectLine`
 * makes it clickable, which is how the left-hand panel is aimed at it, and
 * `onEditLine` turns it into a field the WORDS are typed in. Without those
 * props this is inert markup, so the buyer-facing previews stay exactly what
 * they always were.
 */
/** How close together, in ms and px, two presses have to be to be one
 *  double-click. 500ms is the platform default on Windows and macOS alike. */
const DOUBLE_PRESS_MS = 500;
const DOUBLE_PRESS_SLOP_PX = 6;

/** What a press on a masthead line is worth remembering: which line, where on
 *  screen, and which character it was over while the line was still there. */
function pressRecord(
  line: HeaderLine,
  event: ReactPointerEvent<HTMLElement>,
): { line: HeaderLine; x: number; y: number; offset: number | null; at: number } | null {
  if (event.button !== 0) return null;
  return {
    line,
    x: event.clientX,
    y: event.clientY,
    offset: offsetAtPoint(event.currentTarget, event.clientX, event.clientY),
    at: event.timeStamp,
  };
}

/** Eat the click the swallowed press is about to produce — by then the pointer
 *  may be over a tile, and that tile must not select itself. Dropped again
 *  shortly after in case the press never becomes a click at all. */
function swallowNextClick() {
  const swallow = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("click", swallow, { capture: true, once: true });
  window.setTimeout(
    () => document.removeEventListener("click", swallow, true),
    DOUBLE_PRESS_MS,
  );
}

export function StorefrontMasthead({
  header,
  theme,
  compact = false,
  activeLine = null,
  onSelectLine,
  editingLine = null,
  editingRange = null,
  onEditLine,
  onLineTextChange,
  onToggleLineFormat,
  onEditDone,
}: {
  header: StorefrontHeader;
  theme: StorefrontTheme;
  compact?: boolean;
  /** The line the style panel is currently editing, if any. */
  activeLine?: HeaderLine | null;
  /** Present only in the editor: makes each line selectable. */
  onSelectLine?: (line: HeaderLine) => void;
  /** The line whose words are being typed in place, if any. */
  editingLine?: HeaderLine | null;
  /** Where the caret goes when that editor opens: the word the double-click
   *  landed on, or null for the end of the line. */
  editingRange?: TextRange | null;
  /** Double-click (or a second click on the line already open in the panel):
   *  start typing, carrying whatever the click selected. */
  onEditLine?: (line: HeaderLine, range: TextRange | null) => void;
  onLineTextChange?: (line: HeaderLine, value: string) => void;
  onToggleLineFormat?: (
    line: HeaderLine,
    format: "bold" | "italic" | "underline",
  ) => void;
  onEditDone?: () => void;
}) {
  /**
   * DOUBLE-CLICK, MADE PROOF AGAINST THE BOARD MOVING UNDER IT.
   *
   * The first press selects the line, which opens the docked left panel; the
   * workspace narrows, the canvas re-clamps its pan, and the line slides
   * sideways before the second press lands. That press can miss it entirely,
   * and then the browser never fires `dblclick` — the seller gets the panel and
   * no caret, and has to click again.
   *
   * So the pair is matched by POINT AND TIME at the document level instead of
   * by element: a second press in the same spot, in the same breath, is the
   * double-click it was meant to be wherever the line has got to by then. The
   * word is the one worked out under the FIRST press, before anything moved.
   *
   * Once the line is a field, this steps aside entirely: presses inside it are
   * the caret's, and the browser's own double-click-selects-a-word applies.
   */
  const press = useRef<{
    line: HeaderLine;
    x: number;
    y: number;
    offset: number | null;
    at: number;
  } | null>(null);
  const live = useRef({ header, editingLine, onEditLine });
  useEffect(() => {
    live.current = { header, editingLine, onEditLine };
  });
  // Editor only: a buyer-facing render has no lines to type in and takes no
  // listener at all.
  const editable = Boolean(onEditLine);
  useEffect(() => {
    if (!editable) return;
    function onPointerDown(event: PointerEvent) {
      const previous = press.current;
      press.current = null;
      const { header, editingLine, onEditLine } = live.current;
      if (!onEditLine || editingLine || !previous) return;
      if (event.button !== 0) return;
      if (event.timeStamp - previous.at > DOUBLE_PRESS_MS) return;
      if (
        Math.hypot(event.clientX - previous.x, event.clientY - previous.y) >
        DOUBLE_PRESS_SLOP_PX
      ) {
        return;
      }
      // This press has been spent on the second half of a double-click, so
      // nothing under the pointer may also act on it: no marquee, no tile
      // selection, and no click behind it either.
      event.preventDefault();
      event.stopPropagation();
      swallowNextClick();
      onEditLine(
        previous.line,
        previous.offset === null
          ? null
          : wordRangeAt(header[previous.line], previous.offset),
      );
    }
    // Capture on the document, which is ABOVE React's own root listener: that
    // is what lets the press be claimed before anything else sees it.
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [editable]);

  const name = header.name.trim();
  const bio = header.bio.trim();
  // A line being typed in stays on the board even once it has been emptied:
  // the caret has to have somewhere to sit, or the first Backspace that
  // clears the words would also take the field away.
  const editing = (line: HeaderLine) => Boolean(onEditLine) && editingLine === line;
  // SF-02: In the editor (editable=true) we keep the masthead visible even
  // when both fields are empty so the seller can discover and click them.
  // On the buyer-facing page (editable=false) we respect the existing rule:
  // no content means no masthead rendered at all.
  const editorVisible = editable && header.show;
  if (!header.show || (!name && !bio && !editingLine && !editorVisible)) return null;

  // Every color is re-gated on the way out: a config is parsed from a jsonb
  // column and these land in a style attribute.
  const inherited = headerThemeColors(theme.accent);
  const nameColor = isStrictHexColor(header.nameColor ?? "")
    ? header.nameColor
    : inherited.name;
  const bioColor = isStrictHexColor(header.bioColor ?? "")
    ? header.bioColor
    : // No override: keep inheriting the surrounding foreground rather than
      // painting the default ink, so a dark canvas still reads as it always did.
      undefined;

  // A stored size replaces the line's class-driven scale, so the two never
  // fight over the same property. The compact preview keeps its own small type
  // whatever the storefront says: a 72px store name would fill a list card.
  const sizeOf = (line: HeaderLine): number | undefined => {
    const size = headerStyleValue(header, line, "size");
    return compact ? undefined : size;
  };

  /** A line's typeface. Absent (or an uploaded face this canvas could not
   *  resolve) leaves it inheriting, exactly as a text block does. */
  const fontOf = (line: HeaderLine) =>
    fontPresentation(headerStyleValue(header, line, "font"));

  const styleOf = (line: HeaderLine, color?: string): CSSProperties => {
    const size = sizeOf(line);
    return {
      ...(size ? textSizeStyle(size) : undefined),
      ...(color ? { color } : undefined),
      ...fontOf(line).style,
    };
  };

  /** Bold / italic / underline / alignment, as tokenized classes. The compact
   *  preview keeps the formatting (it is what the line IS) but not the
   *  alignment, which only means something at full width.
   *
   *  A line with no alignment of its own emits no class at all, rather than an
   *  explicit `text-left`: "unstyled" should look the same in the DOM as it
   *  does in storage, and inheriting is what the masthead has always done. */
  const alignOf = (line: HeaderLine) => headerStyleValue(header, line, "align");
  const formatClass = (line: HeaderLine) =>
    cn(
      headerStyleValue(header, line, "bold") && "font-bold",
      headerStyleValue(header, line, "italic") && "italic",
      headerStyleValue(header, line, "underline") && "underline",
      !compact && alignOf(line) && TEXT_ALIGN_CLASSES[alignOf(line)!],
      fontOf(line).className,
    );

  /**
   * Start typing in a line, aimed at what the press was aimed at: a
   * double-click takes the word under the pointer, a single click a caret
   * where it landed. Worked out from the point rather than read off the
   * browser's selection, which the canvas suppresses so that a drag across the
   * board rubber-bands instead of selecting text.
   */
  const beginEdit = (line: HeaderLine, event: MouseEvent<HTMLElement> | null) => {
    const node = event?.currentTarget ?? null;
    const offset = node
      ? offsetAtPoint(node, event!.clientX, event!.clientY)
      : null;
    const range =
      offset === null
        ? null
        : event!.detail > 1
          ? wordRangeAt(header[line], offset)
          : { start: offset, end: offset };
    onEditLine?.(line, range);
  };

  /** Editor-only: the hit area, its keyboard equivalent, and the ring that
   *  says which line the style panel is on. Empty outside the designer. */
  const selectable = (line: HeaderLine) =>
    onSelectLine
      ? {
          role: "button" as const,
          tabIndex: 0,
          "aria-label": `Edit the store ${line}`,
          "aria-pressed": activeLine === line,
          onClick: (event: MouseEvent<HTMLElement>) => {
            // A click on the line the panel is ALREADY on means "let me type",
            // the same click-to-select, click-to-edit a text tile has. It is
            // also the reliable half of the double-click below: selecting a
            // line opens the left panel, which slides the board sideways
            // between the two presses.
            if (activeLine === line && onEditLine) {
              beginEdit(line, event);
              return;
            }
            onSelectLine(line);
          },
          onDoubleClick: (event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            event.stopPropagation();
            beginEdit(line, event);
          },
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            // Enter on the line the panel is on starts typing (the keyboard's
            // double-click); Space stays pure selection, so there is always a
            // key that only aims the panel.
            if (event.key === "Enter" && activeLine === line && onEditLine) {
              event.preventDefault();
              beginEdit(line, null);
              return;
            }
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            onSelectLine(line);
          },
        }
      : {};

  const selectableClass = (line: HeaderLine) =>
    onSelectLine &&
    cn(
      "cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      activeLine === line
        ? "ring-2 ring-ring ring-offset-1"
        : "hover:ring-1 hover:ring-border",
    );

  /** The look of a line, shared by the static node and the editor that
   *  replaces it, so entering edit mode changes nothing but the caret. */
  const nameClass = cn(
    // The line's own weight beats this default, so a seller who asked for bold
    // gets 700 rather than the masthead's semibold.
    "font-semibold",
    compact ? "truncate text-sm" : !sizeOf("name") && "text-xl sm:text-2xl",
    formatClass("name"),
  );
  const bioClass = cn(
    "whitespace-pre-line",
    compact ? "truncate text-xs" : !sizeOf("bio") && "text-sm",
    formatClass("bio"),
  );

  return (
    <div className={cn("space-y-1", compact ? "mb-2" : "mb-4")}>
      {editing("name") ? (
        <MastheadLineEditor
          line="name"
          value={header.name}
          initialRange={editingRange}
          className={nameClass}
          style={styleOf("name", nameColor)}
          onChange={(value) => onLineTextChange?.("name", value)}
          onToggleFormat={(format) => onToggleLineFormat?.("name", format)}
          onDone={() => onEditDone?.()}
        />
      ) : (
        (name || editorVisible) && (
          <h2
            {...selectable("name")}
            // Arms the double-press above, reading the word this press is on
            // while the line is still where the seller aimed it.
            onPointerDown={
              onEditLine
                ? (event) => {
                    press.current = pressRecord("name", event);
                  }
                : undefined
            }
            className={cn(nameClass, selectableClass("name"))}
            style={styleOf("name", nameColor)}
          >
            {name ? (
              header.name
            ) : (
              // SF-02: Placeholder copy is shown only in the editor. Buyers
              // never see this text: the masthead returns null when the buyer
              // page renders with an empty name. Click to type replaces it.
              <span className="text-muted-foreground opacity-50 select-none">
                Your store name
              </span>
            )}
          </h2>
        )
      )}
      {editing("bio") ? (
        <MastheadLineEditor
          line="bio"
          value={header.bio}
          initialRange={editingRange}
          className={bioClass}
          style={styleOf("bio", bioColor)}
          onChange={(value) => onLineTextChange?.("bio", value)}
          onToggleFormat={(format) => onToggleLineFormat?.("bio", format)}
          onDone={() => onEditDone?.()}
        />
      ) : (
        (bio || editorVisible) && (
          <p
            {...selectable("bio")}
            onPointerDown={
              onEditLine
                ? (event) => {
                    press.current = pressRecord("bio", event);
                  }
                : undefined
            }
            className={cn(bioClass, selectableClass("bio"))}
            style={styleOf("bio", bioColor)}
          >
            {bio ? (
              header.bio
            ) : (
              // SF-02: Placeholder, editor only.
              <span className="text-muted-foreground opacity-50 select-none">
                A short line about your shop
              </span>
            )}
          </p>
        )
      )}
    </div>
  );
}
