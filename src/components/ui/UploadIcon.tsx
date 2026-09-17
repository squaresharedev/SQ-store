import { cn } from "@/lib/utils";

/**
 * Custom `upload` icon where the ARROW is its own group and can animate
 * independently of the base icon. The frame stays put while the arrow moves.
 *
 * The arrow animation lives in globals.css (`.upload-arrow`), keyed off the
 * `group/btn` scope every shared button already carries — see control-styles.ts.
 */
export function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // `overflow-visible`: the arrow's head may extend past the viewBox
      // when animated.
      className={cn("overflow-visible", className)}
      aria-hidden="true"
    >
      {/* Frame stays put. */}
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      {/* The arrow — the only part that moves. */}
      <g className="upload-arrow">
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </g>
    </svg>
  );
}
