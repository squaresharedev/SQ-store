"use client";

import type { ShapeBlock } from "@/types/storefront";
import { isStrictHexColor } from "@/lib/validation/storefront";

/**
 * The visual face of a shape block — a fixed kind→markup map with NO free-form
 * CSS. Every shape resolves through code-defined classes and structure; the only
 * user data that touches a style attribute is `block.color`, and only after
 * passing `isStrictHexColor`. If the color fails that gate the shape still
 * renders, falling back to `bg-muted` (fill) or `border-muted` (stroke) so it
 * stays visible and the canvas never crashes. `spacer` ignores color entirely.
 *
 * Allowlist contract: adding a new ShapeKind requires a matching branch here.
 * Anything not in the switch is a compile-time error (exhaustive + no default).
 * User input NEVER becomes raw CSS — not a class name, not a gradient string,
 * not a property key. Only the pre-validated hex may appear in `style`.
 */
export function ShapeTileContent({
  block,
  editable = false,
}: {
  block: ShapeBlock;
  editable?: boolean;
}) {
  // Gate the stored color before it touches any style attribute.
  const validColor = isStrictHexColor(block.color) ? block.color : null;

  // backgroundColor / borderColor only set when the hex passed the gate.
  const fillStyle = validColor ? { backgroundColor: validColor } : undefined;
  const strokeStyle = validColor ? { borderColor: validColor } : undefined;

  // Fallback fill class for when the color is absent / invalid.
  const fallbackFill = validColor ? "" : "bg-muted";
  const fallbackStroke = validColor ? "" : "border-muted";

  let shape: React.ReactNode;

  switch (block.kind) {
    case "square":
      shape = (
        <div
          className={`size-full ${fallbackFill}`}
          style={fillStyle}
          aria-hidden="true"
        />
      );
      break;

    case "circle":
      shape = (
        <div
          className={`size-full rounded-full ${fallbackFill}`}
          style={fillStyle}
          aria-hidden="true"
        />
      );
      break;

    case "ring":
      // Transparent fill; only the border carries the color.
      shape = (
        <div
          className={`size-full rounded-full border-8 ${fallbackStroke}`}
          style={strokeStyle}
          aria-hidden="true"
        />
      );
      break;

    case "diamond":
      // Rotated square. The flex-centered parent clips the corners sensibly.
      shape = (
        <div
          className={`h-3/4 w-3/4 rotate-45 ${fallbackFill}`}
          style={fillStyle}
          aria-hidden="true"
        />
      );
      break;

    case "spacer":
      if (!editable) {
        // Pure layout whitespace in the buyer view — no visible output.
        return <div className="flex-1" aria-hidden="true" />;
      }
      // Designer view: dashed outline with a label so the seller can see it.
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center p-2">
          <div className="flex size-full items-center justify-center border border-dashed border-border">
            <span className="font-inter text-xs text-muted-foreground">
              Spacer
            </span>
          </div>
        </div>
      );
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-2">
      {shape}
    </div>
  );
}
