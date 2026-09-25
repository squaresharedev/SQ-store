"use client";

import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { useTranslations } from "next-intl";
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
 * In the DESIGNER (and only there) each line is also a target: a click both
 * aims the left-hand panel at it (`onSelectLine`'s job) and drops a caret in
 * it (`onEditLine`'s), in one motion — see `selectable` below. Without those
 * props this is inert markup, so the buyer-facing previews stay exactly what
 * they always were.
 */

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
  /** Where the caret goes when that editor opens: where the click landed (or
   *  the word under it, for a genuine double/triple click), or null for the
   *  end of the line. */
  editingRange?: TextRange | null;
  /** The first click on a line starts typing there directly, carrying
   *  whatever the click landed on. */
  onEditLine?: (line: HeaderLine, range: TextRange | null) => void;
  onLineTextChange?: (line: HeaderLine, value: string) => void;
  onToggleLineFormat?: (
    line: HeaderLine,
    format: "bold" | "italic" | "underline",
  ) => void;
  onEditDone?: () => void;
}) {
  const t = useTranslations("Storefront.masthead");
  // Editor only: a buyer-facing render has no lines to type in.
  const editable = Boolean(onEditLine);

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
   * Start typing in a line, aimed at what the click was aimed at: a genuine
   * double/triple click (event.detail > 1) takes the word under the pointer,
   * an ordinary click a caret where it landed. Worked out from the point
   * rather than read off the browser's selection, which the canvas suppresses
   * so that a drag across the board rubber-bands instead of selecting text.
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

  /** Editor-only: the hit area and its keyboard equivalent — which line the
   *  style panel is on is left to the panel itself (its heading names the
   *  line it opened on), not to a mark on the canvas. Empty outside the
   *  designer.
   *
   *  ONE press does the whole job: a click (or Enter) both aims the panel at
   *  the line AND drops a caret in it — `beginEdit` calls `onEditLine`, whose
   *  handler (StorefrontDesigner's `beginHeaderEdit`) already aims the panel
   *  as part of arming the edit, so there is nothing left for a separate
   *  select-then-edit step to do. Space is kept as the one way to aim the
   *  panel WITHOUT opening the field, for a keyboard seller who wants the
   *  style controls without a caret in the words. */
  const selectable = (line: HeaderLine) =>
    onSelectLine
      ? {
          role: "button" as const,
          tabIndex: 0,
          "aria-label": t("editAriaLabel", { line }),
          "aria-pressed": activeLine === line,
          onClick: (event: MouseEvent<HTMLElement>) => {
            if (onEditLine) {
              beginEdit(line, event);
              return;
            }
            onSelectLine(line);
          },
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (onEditLine) {
                beginEdit(line, null);
              } else {
                onSelectLine(line);
              }
              return;
            }
            if (event.key !== " ") return;
            event.preventDefault();
            onSelectLine(line);
          },
        }
      : {};

  // No ring on hover or on selection: the line reads exactly as it does on the
  // buyer's page right up until the seller is actually typing in it, and even
  // then MastheadLineEditor draws no box of its own (see there) — the caret is
  // the only sign a line is live. `focus-visible` still lights up for keyboard
  // navigation, which has no caret to fall back on. Same for both lines, so
  // this is one value rather than a per-line function.
  const selectableClass =
    onSelectLine &&
    cn("cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring");

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
            className={cn(nameClass, selectableClass)}
            style={styleOf("name", nameColor)}
          >
            {name ? (
              header.name
            ) : (
              // SF-02: Placeholder copy is shown only in the editor. Buyers
              // never see this text: the masthead returns null when the buyer
              // page renders with an empty name. Click to type replaces it.
              <span className="text-muted-foreground opacity-50 select-none">
                {t("namePlaceholder")}
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
            className={cn(bioClass, selectableClass)}
            style={styleOf("bio", bioColor)}
          >
            {bio ? (
              header.bio
            ) : (
              // SF-02: Placeholder, editor only.
              <span className="text-muted-foreground opacity-50 select-none">
                {t("bioPlaceholder")}
              </span>
            )}
          </p>
        )
      )}
    </div>
  );
}
