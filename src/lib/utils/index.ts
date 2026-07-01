import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and de-duplicate conflicting Tailwind classes.
 * Standard shadcn `cn` helper; matches the marketplace (Home) project so
 * components can be shared later.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
