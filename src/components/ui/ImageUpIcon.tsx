import { cn } from "@/lib/utils";

/**
 * lucide's `image-up`, drawn locally so the ARROW is its own group and can
 * animate independently of the picture frame. Paths are copied verbatim from
 * lucide-react v1.23 (ISC) so it stays pixel-identical to the icon it replaces.
 *
 * The bounce lives in globals.css (`.upload-arrow`), keyed off the `group/btn`
 * scope every shared button already carries — see control-styles.ts.
 */
export function ImageUpIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // `overflow-visible`: the arrow's shaft ends at y=22 and the bounce takes
      // it 3 units lower, past the 24-high viewBox. An <svg> clips to its
      // viewport by default, which sliced the arrowhead off mid-hop.
      className={cn("overflow-visible", className)}
      aria-hidden="true"
    >
      {/* Frame + lens stay put. */}
      <path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21" />
      <circle cx="9" cy="9" r="2" />
      {/* The arrow — the only part that moves. */}
      <g className="upload-arrow">
        <path d="m14 19.5 3-3 3 3" />
        <path d="M17 22v-5.5" />
      </g>
    </svg>
  );
}
