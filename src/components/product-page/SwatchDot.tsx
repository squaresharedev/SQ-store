import { cn } from "@/lib/utils";
import { ruleColor, subtleFill } from "./product-page-maps";

/**
 * A version's colour as a small dot: the checkout's version chips and the
 * page's dropdowns draw a colour with this one dot. The hairline is the page's
 * own rule colour, so a white or pale swatch still has an edge on a light
 * ground. No colour (a swatch group where the seller set none for this one)
 * draws the page's quiet fill, so the names in a list still line up.
 *
 * Server-compatible.
 */
export function SwatchDot({ color, ink, className }: { color?: string; ink: string; className?: string }) {
  return (
    <span
      className={cn("size-3.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color ?? subtleFill(ink), boxShadow: `inset 0 0 0 1px ${ruleColor(ink)}` }}
      aria-hidden="true"
      data-swatch-dot={color ?? ""}
    />
  );
}
