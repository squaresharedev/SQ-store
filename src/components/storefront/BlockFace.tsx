"use client";

import type { RefObject } from "react";
import { AlertCircle } from "lucide-react";
import { infoTextClass } from "@/components/ui/control-styles";
import type { Product } from "@/types/product";
import type {
  StorefrontBlock,
  StorefrontTheme,
  TextSpan,
} from "@/types/storefront";
import type {
  InlineFormatKey,
  TextEditSource,
  TextRange,
} from "./InlineTextEditor";
import { ImageTileContent } from "./ImageTileContent";
import { ProductTileContent } from "./ProductTileContent";
import { ShapeTileContent } from "./ShapeTileContent";
import { TextTileContent } from "./TextTileContent";

/**
 * The visual face of one grid block, independent of tile chrome: dispatches to
 * the text, shape, image, or product content, or the flagged "product removed"
 * state when a referenced product no longer exists (never a crash). Used by the
 * in-place tile AND the drag overlay, so the floating copy always matches.
 * A text block's WORDS are typed on this face (see TextTileContent); its
 * styling, like a shape's, stays in the side panel.
 *
 * Block kinds: "text" → TextTileContent, "shape" → ShapeTileContent,
 * "image" → ImageTileContent, "product" → ProductTileContent (or the
 * removed-product fallback).
 */
export function BlockFace({
  block,
  product,
  theme,
  imageRef,
  imageUrl,
  textEditing = false,
  textSelectAll = false,
  onTextChange,
  onToggleBlockFormat,
  onTextRangeChange,
  onTextEditEnd,
}: {
  block: StorefrontBlock;
  product: Product | null;
  theme: StorefrontTheme;
  /** Only the in-place tile passes this, so the framing overlay above it can
   *  measure the picture it is moving. */
  imageRef?: RefObject<HTMLImageElement | null>;
  /** Image blocks only: the server-signed URL for this element's artwork.
   *  The config stores an object key, so the face is handed the resolved URL
   *  rather than resolving one itself. */
  imageUrl?: string | null;
  /** Text blocks only: this block's words are being typed in place. */
  textEditing?: boolean;
  textSelectAll?: boolean;
  /** Text and the spans that format parts of it, always together. */
  onTextChange?: (text: string, spans: TextSpan[], source: TextEditSource) => void;
  /** Ctrl+B / I / U with nothing selected: the whole block. */
  onToggleBlockFormat?: (key: InlineFormatKey) => void;
  /** The live selection inside the editor, for the panel's colour picker. */
  onTextRangeChange?: (range: TextRange | null) => void;
  onTextEditEnd?: () => void;
}) {
  if (block.type === "text") {
    return (
      <TextTileContent
        block={block}
        theme={theme}
        editing={textEditing}
        selectAllOnEdit={textSelectAll}
        onTextChange={onTextChange}
        onToggleBlockFormat={onToggleBlockFormat}
        onRangeChange={onTextRangeChange}
        onEditEnd={onTextEditEnd}
      />
    );
  }
  if (block.type === "shape") {
    return <ShapeTileContent block={block} />;
  }
  if (block.type === "image") {
    return (
      <ImageTileContent
        block={block}
        src={imageUrl ?? null}
        imageRef={imageRef}
      />
    );
  }
  if (product) {
    return (
      <ProductTileContent
        product={product}
        theme={theme}
        overrides={block.style}
        soldOut={block.soldOut === true}
        imagePlacement={block.imagePlacement}
        imageRef={imageRef}
      />
    );
  }
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center">
      <AlertCircle
        className="size-5 text-destructive"
        strokeWidth={2}
        aria-hidden="true"
      />
      <span className={infoTextClass}>
        Product removed. Delete this block.
      </span>
    </div>
  );
}
