import { cn } from "@/lib/utils";
import { skeletonClass } from "@/components/ui/surface-styles";

/**
 * One shimmering placeholder bar. Give it a size (and any shape override) via
 * `className`; the pulse, the radius and the tone come from the token, so the
 * whole app's loading state changes in one edit.
 *
 * Always `aria-hidden`: a skeleton is a picture of content that isn't there
 * yet. The screen-reader story is a single "loading X" line next to the grid
 * of them, which each skeleton container owns.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn(skeletonClass, className)} />;
}
