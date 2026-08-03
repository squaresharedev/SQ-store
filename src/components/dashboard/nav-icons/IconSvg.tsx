import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { NavIconProps } from "./types";

/**
 * The shared frame every nav icon draws into: lucide's viewBox, stroke weight
 * and caps, so an icon at rest is pixel-identical to the static original.
 *
 * Overflow is visible because several stories deliberately cross the viewBox
 * edge (sparks flying off the cart, box flaps unfolding past the carton).
 * Icons that need a hard boundary clip themselves with a clipPath instead.
 */
export function IconSvg({
  className,
  children,
}: NavIconProps & { children: ReactNode }) {
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
      className={cn("size-5 shrink-0 overflow-visible", className)}
    >
      {children}
    </svg>
  );
}
