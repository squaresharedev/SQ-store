import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The shared frame every animated action icon draws into: lucide's viewBox,
 * stroke weight and caps, so an icon at rest is pixel-identical to the static
 * lucide original it replaces.
 *
 * Sized `size-4` rather than the nav rail's `size-5`, because these sit in
 * button chrome (a size-9 icon button, a text button's leading slot) where
 * lucide was already being rendered at 16px.
 *
 * Overflow is visible: a lid swinging open and a key turning both leave the
 * viewBox briefly, and clipping them mid-swing reads as a rendering bug rather
 * than as a boundary.
 */
export function ActionIconSvg({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("size-4 shrink-0 overflow-visible", className)}
    >
      {children}
    </svg>
  );
}
