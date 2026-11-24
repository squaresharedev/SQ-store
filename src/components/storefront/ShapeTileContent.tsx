"use client";

import { useId, type CSSProperties } from "react";
import {
  RING_DEFAULT_WIDTH,
  type GradientFill,
  type ShapeBlock,
  type ShapeKind,
} from "@/types/storefront";
import { gradientLine, gradientStops } from "@/lib/storefront/gradients";
import { boxPaint, ringGradientStyle, shapeGradient } from "./shape-fill";
import { isStrictHexColor } from "@/lib/validation/predicates";
import { cn } from "@/lib/utils";
import { SHAPE_SPECS } from "./shape-specs";
import { defaultRoundness, shapePath, supportsRoundness } from "./shape-geometry";

/**
 * The visual face of a shape block. Every shape fills its tile edge to edge
 * and stretches with it (a circle on a wide tile is an oval; a stretched
 * triangle is a wide triangle). The only user data that reaches a style
 * attribute is the block's colors — each gated by `isStrictHexColor` — and
 * its schema-bounded integers (border width, opacity, roundness, points). A
 * color that fails the gate falls back to muted tokens, so the shape stays
 * visible and the canvas never crashes. A gradient (shape-fill) is drawn only
 * when every one of its stops passes the same gate.
 *
 * Allowlist contract: config data selects a shape by KEY only, and the
 * geometry parameters resolve through shape-geometry's code-defined path
 * generation. User input NEVER becomes raw CSS or raw path data.
 *
 * Three rendering paths:
 * - `ring`: border-only ellipse, its stroke painted by `color`.
 * - path kinds (star, hexagon, ...): ONE stretched SVG. The path is
 *   generated (so point count and corner roundness are adjustable); the
 *   outline is a stroke clipped to the shape's inside at double width, which
 *   keeps it a uniform `borderWidth` px at any stretch
 *   (vector-effect: non-scaling-stroke).
 * - the box kinds: one div with a real CSS border; corner roundness is
 *   applied in cqmin (percent of the tile's SHORTER side), so rounding
 *   stays uniform when the tile is not square.
 */
export function ShapeTileContent({ block }: { block: ShapeBlock }) {
  const clipId = useId();
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

  const roundness = block.roundness ?? defaultRoundness(block.kind);
  const path = shapePath(block.kind, {
    points: block.points,
    roundness,
  });
  // Painted instead of `color` when present (shape-fill).
  const gradient = shapeGradient(block);
  const gradientId = `${clipId}-fill`;

  let shape: React.ReactNode;

  if (path) {
    shape = (
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        // The 100x100 shape box stretches with the tile; the outline stays
        // uniform anyway via non-scaling-stroke below.
        preserveAspectRatio="none"
        className="size-full"
        style={opacityStyle}
      >
        {borderWidth > 0 && (
          <clipPath id={clipId}>
            <path d={path} />
          </clipPath>
        )}
        {gradient && <ShapeGradientDef id={gradientId} fill={gradient.fill} />}
        <path
          d={path}
          className={validColor || gradient ? undefined : "fill-muted"}
          style={gradient ? { fill: `url(#${gradientId})` } : validColor ? { fill: validColor } : undefined}
          {...(borderWidth > 0
            ? {
                // Centered stroke at double width, clipped to the shape:
                // an INSIDE outline of exactly borderWidth, matching the
                // CSS-border look of the box kinds.
                clipPath: `url(#${clipId})`,
                stroke: validBorderColor ?? "var(--color-foreground)",
                strokeWidth: borderWidth * 2,
                vectorEffect: "non-scaling-stroke" as const,
              }
            : {})}
        />
      </svg>
    );
  } else if (block.kind === "ring") {
    // The ring IS its stroke: `color` paints the border and the width slider
    // doubles as the ring's thickness.
    shape = (
      <div
        aria-hidden="true"
        className={cn(spec.className, validColor || gradient ? "" : "border-muted")}
        style={{
          borderStyle: "solid",
          borderWidth: borderWidth > 0 ? borderWidth : RING_DEFAULT_WIDTH,
          ...(gradient ? ringGradientStyle(gradient.css) : validColor ? { borderColor: validColor } : {}),
          ...opacityStyle,
        }}
      />
    );
  } else {
    // Adjustable corner roundness for the box kinds that support it, in cqmin
    // so corners stay uniform on stretched tiles. The fully round kinds
    // (circle, pill, ...) carry their radius in classes.
    const radiusStyle: CSSProperties =
      roundness > 0 && supportsRoundness(block.kind)
        ? { borderRadius: `${roundness}cqmin` }
        : {};

    shape =
      borderWidth > 0 ? (
        /**
         * TWO BOXES, NOT ONE BORDER, and the corners are the whole reason.
         *
         * A CSS border derives its INNER radius by subtracting its own width
         * from the outer one and clamping at zero — so a 12px outline on a
         * gently rounded square came out rounded on the outside and dead sharp
         * on the inside, which is not a stroke anyone draws on purpose. Here
         * the outline is a plate in the border colour and the fill is a second
         * box inset by its width, taking the SAME radius through `inherit`.
         * Both edges are then curved by exactly what the seller set.
         */
        <div
          aria-hidden="true"
          className={cn(spec.className, validBorderColor ? "" : "bg-foreground")}
          style={{
            ...(validBorderColor
              ? { backgroundColor: validBorderColor }
              : {}),
            ...radiusStyle,
            ...opacityStyle,
            position: "relative",
          }}
        >
          <span
            aria-hidden="true"
            className={cn("absolute", validColor || gradient ? "" : "bg-muted")}
            style={{
              inset: borderWidth,
              borderRadius: "inherit",
              ...boxPaint(validColor, gradient?.css ?? null),
            }}
          />
        </div>
      ) : (
        <div
          aria-hidden="true"
          className={cn(spec.className, validColor || gradient ? "" : "bg-muted")}
          style={{
            ...boxPaint(validColor, gradient?.css ?? null),
            ...radiusStyle,
            ...opacityStyle,
          }}
        />
      );
  }

  return (
    // Edge to edge: no padding, the shape spans the whole tile. A SIZE
    // container, so cqmin radii resolve against the tile's shorter side.
    // Containment is safe here: the wrapper's size comes from the tile's
    // flex column, never its content.
    <div className="flex min-h-0 flex-1 items-center justify-center [container-type:size]">
      {shape}
    </div>
  );
}

/** A path kind's gradient, in the shape box's own units so it runs across the
 *  tile the way a box kind's CSS gradient does (gradientLine). */
function ShapeGradientDef({ id, fill }: { id: string; fill: GradientFill }) {
  const stops = gradientStops(fill);
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" {...gradientLine(fill.angle)}>
      {stops.map((stop, index) => (
        <stop key={index} offset={index / (stops.length - 1)} stopColor={stop} />
      ))}
    </linearGradient>
  );
}

/**
 * Tiny icon version of a shape kind, drawn in `currentColor` so it follows
 * the surrounding button's text color. Used by the toolbar's shape menu and
 * the shape inspector's kind grid — pickers show the SHAPES themselves, no
 * text. Path kinds draw their real (default-parameter) geometry.
 */
export function ShapeKindGlyph({ kind }: { kind: ShapeKind }) {
  const spec = SHAPE_SPECS[kind];
  const path = shapePath(kind);
  if (path) {
    return (
      <svg aria-hidden="true" viewBox="0 0 100 100" className="size-3.5">
        <path d={path} className="fill-current" />
      </svg>
    );
  }
  if (kind === "ring") {
    return (
      <span
        aria-hidden="true"
        className={cn(spec.glyphClassName, "border-2 border-current")}
      />
    );
  }
  return (
    <span aria-hidden="true" className={cn(spec.glyphClassName, "bg-current")} />
  );
}
