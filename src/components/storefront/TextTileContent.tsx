"use client";

import { useEffect, useRef } from "react";
import {
  TEXT_SIZE_MIN,
  TEXT_VARIANT_BASE_PX,
  blockKey,
  type StorefrontTheme,
  type TextBlock,
  type TextSpan,
  type TextStyle,
} from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { segmentText } from "@/lib/storefront/text-spans";
import { fontPresentation } from "@/lib/theme/storefront-fonts";
import { cn } from "@/lib/utils";
import {
  TEXT_ALIGN_CLASSES,
  TEXT_VARIANT_WEIGHT_CLASSES,
  textSizeStyle,
} from "./config-maps";
import { useAutoFitRegistry } from "./text-autofit-registry";
import { useAutoFitTextSize } from "./useAutoFitTextSize";
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

  // The box the words have to fit inside, and the words themselves — two refs
  // rather than one because which element holds the words depends on editing
  // mode (the static paragraph, or InlineTextEditor's own node).
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);

  // An explicit size is the seller's own choice, cropped or not, and is never
  // shrunk out from under them; only Auto (no stored size) fits itself to the
  // box.
  const autoFit = block.fontSize === undefined;
  const autoFitSize = useAutoFitTextSize({
    containerRef,
    textRef,
    ceiling: TEXT_VARIANT_BASE_PX[block.variant],
    floor: TEXT_SIZE_MIN,
    enabled: autoFit,
    deps: [
      block.text,
      block.spans,
      block.bold,
      block.italic,
      block.underline,
      block.font,
      block.variant,
      block.align,
      editing,
    ],
  });
  const resolvedSize = block.fontSize ?? autoFitSize;

  // Published so the inspector's "Auto (NN px)" — and the slider's own
  // starting point — describe what this block is ACTUALLY rendering at, not
  // the flat number its style would use in an infinite box. See
  // text-autofit-registry for why this is a registry rather than a prop.
  const registry = useAutoFitRegistry();
  const key = blockKey(block);
  useEffect(() => {
    if (!registry) return;
    if (!autoFit) {
      registry.clear(key);
      return;
    }
    registry.report(key, autoFitSize);
  }, [registry, key, autoFit, autoFitSize]);

  // Shared by the static paragraph and the editable one, so entering and
  // leaving edit mode does not move a single pixel of the text. Sizing is
  // always this inline px (never the variant's own text-* class): a size
  // that only ever applied above some breakpoint could not be measured
  // against the box it has to fit, which auto-fit needs unconditionally.
  const bodyClass = cn(
    TEXT_VARIANT_WEIGHT_CLASSES[block.variant],
    block.bold && "font-bold",
    block.italic && "italic",
    block.underline && "underline",
  );
  const bodyStyle = {
    ...textSizeStyle(resolvedSize),
    ...(color ? { color } : undefined),
  };

  return (
    <div
      ref={containerRef}
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
          nodeRef={textRef}
          onChange={onTextChange}
          onToggleBlockFormat={onToggleBlockFormat}
          onRangeChange={onRangeChange}
          onDone={onEditEnd}
        />
      ) : (
        <p key="static" ref={textRef} className={bodyClass} style={bodyStyle}>
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
