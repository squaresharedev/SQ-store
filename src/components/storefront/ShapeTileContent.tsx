"use client";

import type { CSSProperties } from "react";
import {
  RING_DEFAULT_WIDTH,
  type ShapeBlock,
  type ShapeKind,
} from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";
import { cn } from "@/lib/utils";
import { SHAPE_SPECS } from "./shape-specs";

/**
 * The visual face of a shape block. Every shape resolves through the fixed
 * SHAPE_SPECS map (code-defined classes + clip-paths, exhaustive over
 * ShapeKind); the only user data that reaches a style attribute is the block's
 * colors — each gated by `isStrictHexColor` — and its numeric border width and
 * opacity, both bounded by the schema. A color that fails the gate falls back
 * to `bg-muted` / `border-muted`, so the shape stays visible and the canvas
 * never crashes.
 *
 * Allowlist contract: config data selects a spec by KEY only. User input NEVER
 * becomes raw CSS — not a class name, not a clip-path, not a property key.
 *
 * Three rendering paths:
 * - `ring`: border-only circle, its stroke painted by `color`.
 * - clip-path kinds: a border layer under an inset fill layer, because a real
 *   CSS border would be sliced in half by the clip.
 * - the rest: one box with a real CSS border.
 */
export function ShapeTileContent({ block }: { block: ShapeBlock }) {
  const spec = SHAPE_SPECS[block.kind];

  // Gate the stored colors before they touch any style attribute.
  const validColor = isStrictHexColor(block.color) ? block.color : null;
  const validBorderColor =
    block.borderColor && isStrictHexColor(block.borderColor)
      ? block.borderColor
      : null;

  const borderWidth = block.borderWidth ?? 0;
  const opacity = block.opacity ?? 100;
  // Whole-shape transparency; omitted entirely when fully opaque.
  const opacityStyle: CSSProperties =
    opacity < 100 ? { opacity: opacity / 100 } : {};

  // Fallback classes for when a color is absent / invalid.
  const fallbackFill = validColor ? "" : "bg-muted";
  const fallbackBorder = validBorderColor ? "" : "bg-foreground";

  let shape: React.ReactNode;

  if (block.kind === "ring") {
    // The ring IS its stroke: `color` paints the border and the width slider
    // doubles as the ring's thickness.
    shape = (
      <div
        aria-hidden="true"
        className={cn(spec.className, validColor ? "" : "border-muted")}
        style={{
          borderStyle: "solid",
          borderWidth: borderWidth > 0 ? borderWidth : RING_DEFAULT_WIDTH,
          ...(validColor ? { borderColor: validColor } : {}),
          ...opacityStyle,
        }}
      />
    );
  } else if (spec.clip) {
    const clipStyle: CSSProperties = { clipPath: spec.clip };
    shape = (
      <div
        aria-hidden="true"
        className={cn("relative", spec.className)}
        style={opacityStyle}
      >
        {/* Bottom layer: the outline color, or the fill when there is no
            outline. */}
        <div
          className={cn(
            "absolute inset-0",
            borderWidth > 0 ? fallbackBorder : fallbackFill,
          )}
          style={{
            ...clipStyle,
            backgroundColor:
              (borderWidth > 0 ? validBorderColor : validColor) ?? undefined,
          }}
        />
        {/* Top layer: the fill, inset by the outline width. */}
        {borderWidth > 0 && (
          <div
            className={cn("absolute", fallbackFill)}
            style={{
              ...clipStyle,
              inset: borderWidth,
              backgroundColor: validColor ?? undefined,
            }}
          />
        )}
      </div>
    );
  } else {
    shape = (
      <div
        aria-hidden="true"
        className={cn(
          spec.className,
          fallbackFill,
          borderWidth > 0 && !validBorderColor && "border-foreground",
        )}
        style={{
          ...(validColor ? { backgroundColor: validColor } : {}),
          ...(borderWidth > 0
            ? {
                borderStyle: "solid",
                borderWidth,
                ...(validBorderColor ? { borderColor: validBorderColor } : {}),
              }
            : {}),
          ...opacityStyle,
        }}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-2">
      {shape}
    </div>
  );
}

/**
 * Tiny icon version of a shape kind, drawn in `currentColor` so it follows
 * the surrounding button's text color. Used by the toolbar's shape menu and
 * the shape inspector's kind grid — pickers show the SHAPES themselves, no
 * text.
 */
export function ShapeKindGlyph({ kind }: { kind: ShapeKind }) {
  const spec = SHAPE_SPECS[kind];
  if (kind === "ring") {
    return (
      <span
        aria-hidden="true"
        className={cn(spec.glyphClassName, "border-2 border-current")}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(spec.glyphClassName, "bg-current")}
      style={spec.clip ? { clipPath: spec.clip } : undefined}
    />
  );
}
