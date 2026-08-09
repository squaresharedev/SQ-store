import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ToastTone } from "@/components/ui/Toast";

/**
 * The tone mark on a toast: a bare stroke, in the tone's own colour, drawn on
 * as the toast arrives.
 *
 * NO chip, plate or disc behind it. The card is already a bordered surface, and
 * a filled badge sitting on it made a second box inside the first — the mark
 * has to be the thing that carries the tone, not a container it lives in.
 *
 * SIZED PER TONE, which is not an inconsistency. A check and a cross are pure
 * geometry, they carry the whole outcome, and they run edge to edge of the
 * viewBox so they read at the small size rather than needing a big one. An "i"
 * is a GLYPH — scaled up to match, it stops reading as an icon and starts
 * reading as a typo — so the neutral tone sits one step below.
 *
 * They stay SMALL. A mark is what you glance at on the way to the words; sized
 * up to compete with them it becomes the thing being read, and a toast is a
 * sentence, not a symbol with a caption.
 *
 * `pathLength="1"` on every mark normalises its length, so one keyframe draws a
 * check, a cross and an "i" alike without hand-measuring three dash arrays.
 */

type Mark = {
  /** Rendered size. Overridable by the caller (tailwind-merge takes the last). */
  size: string;
  /**
   * Stroke in viewBox units. Set per tone so the ON-SCREEN weight stays even:
   * the same 2.25 that reads right at 24px is a slab at 32px.
   */
  stroke: number;
  art: ReactNode;
};

const MARK: Record<ToastTone, Mark> = {
  // Corner at (7.2,15.6), arms out to the very edges. Both arms are true 45°,
  // so the tick reads as drawn rather than sagging on one side.
  success: {
    size: "size-5",
    stroke: 2,
    art: <path className="toast-mark" pathLength="1" d="M2.2 10.6l5 5L17.8 5" />,
  },
  error: {
    size: "size-5",
    stroke: 2,
    art: (
      <>
        <path className="toast-mark" pathLength="1" d="M2.9 2.9l14.2 14.2" />
        {/* The second stroke lands just after the first, so the mark reads as
            being drawn rather than stamped. */}
        <path
          className="toast-mark toast-mark-delayed"
          pathLength="1"
          d="M17.1 2.9l-14.2 14.2"
        />
      </>
    ),
  },
  info: {
    size: "size-4",
    stroke: 2.25,
    art: (
      <>
        <path className="toast-mark" pathLength="1" d="M10 8.4v6.8" />
        {/* The tittle is a fill, not a stroke, so it fades in rather than draws. */}
        <circle
          className="toast-tittle"
          cx="10"
          cy="4.2"
          r="1.3"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),
  },
};

/**
 * Takes its colour from `currentColor`, so the caller sets it with a text
 * utility (text-success / text-destructive / text-foreground) and nothing here
 * hard-codes a value — which is also what makes it correct in dark mode.
 */
export function ToastToneIcon({
  tone,
  className,
}: {
  tone: ToastTone;
  className?: string;
}) {
  const mark = MARK[tone];
  return (
    <svg
      viewBox="0 0 20 20"
      className={cn(mark.size, "shrink-0", className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={mark.stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {mark.art}
    </svg>
  );
}
