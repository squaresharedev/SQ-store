"use client";

import type { StorefrontTheme, TextBlock, TextSpan, TextStyle } from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { segmentText } from "@/lib/storefront/text-spans";
import { fontPresentation } from "@/lib/theme/storefront-fonts";
import { cn } from "@/lib/utils";
import {
  TEXT_ALIGN_CLASSES,
  TEXT_VARIANT_CLASSES,
  TEXT_VARIANT_WEIGHT_CLASSES,
  textSizeStyle,
} from "./config-maps";
import {
  InlineTextEditor,
  type InlineFormatKey,
  type TextEditSource,
  type TextRange,
} from "./InlineTextEditor";

/**
 * The text face of a grid tile — always plain React text nodes, never markup.
 * Formatting that covers only PART of the text (two colours in one sentence,
 * a bold word) arrives as spans and renders as one <span> per run; the text
 * itself stays a plain string throughout.
 *
 * The CONTENT is typed on the tile: click a selected text block (or use its
 * Type button) and this same face becomes the editor, so the seller types at
 * the size, font, colour and alignment the words will actually have.
 * Everything else about a text block stays in the side panel.
 */
export function TextTileContent({
  block,
  theme,
  editing = false,
  selectAllOnEdit = false,
  onTextChange,
  onToggleBlockFormat,
  onRangeChange,
  onEditEnd,
}: {
  block: TextBlock;
  theme: StorefrontTheme;
  /** True when this block's words are being typed in place. */
  editing?: boolean;
  /** Start with everything selected, so typing replaces the block's text.
   *  Used for a freshly inserted block, whose text is only placeholder. */
  selectAllOnEdit?: boolean;
  /** Every keystroke and every in-place format, already capped and normalized. */
  onTextChange?: (text: string, spans: TextSpan[], source: TextEditSource) => void;
  /** Ctrl+B / I / U with nothing selected: the whole block. */
  onToggleBlockFormat?: (key: InlineFormatKey) => void;
  /** The live selection, so the panel's colour picker knows what it is
   *  colouring. */
  onRangeChange?: (range: TextRange | null) => void;
  /** Escape, or focus leaving the tile for anywhere but the design panel. */
  onEditEnd?: () => void;
}) {
  // An explicit block color wins; else headings pick up the accent and other
  // variants stay foreground. Every color is re-gated before touching style.
  const color =
    block.color && isStrictHexColor(block.color)
      ? block.color
      : block.variant === "heading" && isStrictHexColor(theme.accent)
        ? theme.accent
        : undefined;

  // Per-block font override; absent (or an uploaded face the canvas could not
  // resolve) leaves the block inheriting the canvas font.
  const font = fontPresentation(block.font);

  // Shared by the static paragraph and the editable one, so entering and
  // leaving edit mode does not move a single pixel of the text.
  const bodyClass = cn(
    // An explicit size replaces the variant's scale (applied as an inline
    // px value — sizing is free-form now, not five presets); the variant
    // keeps supplying the weight so heading/subheading/body stay distinct.
    block.fontSize
      ? TEXT_VARIANT_WEIGHT_CLASSES[block.variant]
      : TEXT_VARIANT_CLASSES[block.variant],
    block.bold && "font-bold",
    block.italic && "italic",
    block.underline && "underline",
  );
  const bodyStyle = {
    ...(block.fontSize ? textSizeStyle(block.fontSize) : undefined),
    ...(color ? { color } : undefined),
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col justify-center overflow-hidden whitespace-pre-line p-3",
        TEXT_ALIGN_CLASSES[block.align],
        font.className,
      )}
      style={font.style}
    >
      {editing && onTextChange && onToggleBlockFormat && onRangeChange && onEditEnd ? (
        // Keyed apart from the static paragraph so entering edit mode MOUNTS a
        // fresh node: the editor owns its own DOM content and must never
        // inherit a node React was still writing into.
        <InlineTextEditor
          key="editing"
          block={block}
          selectAll={selectAllOnEdit}
          className={bodyClass}
          style={bodyStyle}
          onChange={onTextChange}
          onToggleBlockFormat={onToggleBlockFormat}
          onRangeChange={onRangeChange}
          onDone={onEditEnd}
        />
      ) : (
        <p key="static" className={bodyClass} style={bodyStyle}>
          {block.text ? (
            renderRuns(block.text, block.spans)
          ) : (
            "Empty text block"
          )}
        </p>
      )}
    </div>
  );
}

/** The text as styled runs. One <span> per run, each holding a plain React
 *  text node — the block's own formatting still comes from the paragraph, so a
 *  run only ever states what it CHANGES. */
function renderRuns(text: string, spans: readonly TextSpan[] | undefined) {
  const segments = segmentText(text, spans);
  // The overwhelmingly common case: no part-by-part formatting at all, so the
  // text stays exactly the single text node it has always been.
  if (segments.length === 1 && isPlain(segments[0].style)) return text;
  return segments.map((segment, index) => (
    <span key={index} style={runStyle(segment.style)}>
      {segment.text}
    </span>
  ));
}

function isPlain(style: TextStyle): boolean {
  return (
    style.color === undefined &&
    style.bold === undefined &&
    style.italic === undefined &&
    style.underline === undefined
  );
}

/** A run's overrides as inline style. Colour is re-gated here for the same
 *  reason the block's is: it came out of a jsonb column. */
function runStyle(style: TextStyle): React.CSSProperties {
  return {
    ...(style.color && isStrictHexColor(style.color)
      ? { color: style.color }
      : undefined),
    ...(style.bold !== undefined
      ? { fontWeight: style.bold ? 700 : 400 }
      : undefined),
    ...(style.italic !== undefined
      ? { fontStyle: style.italic ? "italic" : "normal" }
      : undefined),
    ...(style.underline !== undefined
      ? { textDecorationLine: style.underline ? "underline" : "none" }
      : undefined),
  };
}
