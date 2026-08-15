"use client";

import type { CSSProperties, RefObject } from "react";
import { ImageOff } from "lucide-react";
import { imageStyle } from "@/lib/images/placement";
import type { ImageBlock } from "@/types/storefront";
import { infoTextClass } from "@/components/ui/control-styles";

/**
 * The visual face of an uploaded element: the seller's own artwork on the
 * canvas.
 *
 * THE ONE RULE HERE IS THAT THIS IS AN `<img>`, ALWAYS. An element may be an
 * SVG, and an SVG is markup: injecting one into the DOM as HTML, or building
 * an <svg> tree out of stored data, would hand this app the XSS sink it has
 * never had. (tests/unit/search-input-hardening.test.ts asserts that absence
 * across the whole codebase, and scans comments too — which is why this one
 * describes the forbidden call rather than naming it.)
 *
 * Loaded through `<img src>` the browser puts SVG in the spec's secure static
 * mode instead: scripting off, external fetches off, no interactivity. Rasters
 * and vectors therefore take exactly the same path, and there is no branch
 * here that could ever grow one.
 *
 * The stored config holds an object KEY, never a URL; `src` arrives already
 * signed by the server (see presignGetUrl). A null src is normal rather than
 * exceptional — R2 may be unconfigured, or a freshly-added block may still be
 * uploading — so it renders a quiet placeholder, never a broken image.
 *
 * Two fits:
 * - `contain` shows the whole artwork inside the block. A logo keeps its
 *   proportions and nothing is cut off, so there is no cropping to position.
 * - `cover` (the default) fills the block and crops the overflow, positioned
 *   by the shared focal-point model product tiles already use — which is what
 *   lets TileImageFramer frame an element with no code of its own.
 */
export function ImageTileContent({
  block,
  src,
  imageRef,
}: {
  block: ImageBlock;
  /** Server-signed display URL, or null while unavailable. */
  src: string | null;
  /** Only the in-place tile passes this, so the framing overlay above it can
   *  measure the picture it is moving. */
  imageRef?: RefObject<HTMLImageElement | null>;
}) {
  const opacity = block.opacity ?? 100;
  // Whole-block transparency; omitted entirely when fully opaque, so an
  // untouched element carries no inline style at all.
  const opacityStyle: CSSProperties =
    opacity < 100 ? { opacity: opacity / 100 } : {};

  if (!src) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 p-2 text-center">
        <ImageOff
          className="size-5 text-muted-foreground"
          strokeWidth={2}
          aria-hidden="true"
        />
        <span className={infoTextClass}>Image unavailable</span>
      </div>
    );
  }

  const contain = block.fit === "contain";

  return (
    <img
      ref={imageRef}
      src={src}
      // Plain text from the config, and it reaches the page ONLY as this
      // attribute. Empty alt is meaningful: it marks purely decorative
      // artwork, which is what an unlabelled element is.
      alt={block.alt}
      className={contain ? "size-full object-contain" : "size-full object-cover"}
      style={
        contain
          ? opacityStyle
          : { ...imageStyle(block.imagePlacement), ...opacityStyle }
      }
      // The tile owns dragging (it moves the block); letting the browser start
      // a native image drag would fight it.
      draggable={false}
    />
  );
}
