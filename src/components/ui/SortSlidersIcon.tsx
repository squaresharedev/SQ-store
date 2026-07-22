"use client";

import { useId } from "react";

/**
 * Sliders icon for the Sort control. Drawn locally rather than imported from
 * lucide so the three handles are addressable elements: on hover they glide to
 * new positions along their tracks, previewing what the button does (reorder).
 *
 * The gap to the left of each handle is punched out with a MASK, not painted
 * over with a background-coloured stroke — the button's surface changes on
 * hover (bg-accent), which is exactly when the handles move, so any painted
 * spacer would show as a mismatched notch. A mask is a true hole and works on
 * any surface. The knockout strokes carry the same `.sort-handle*` classes as
 * the handles, so hole and handle travel together.
 *
 * Motion lives in globals.css, keyed off a `group/sort` ancestor (the trigger
 * button). Geometry follows lucide's 24×24 / stroke-2 grid; handles are short
 * with butt caps — square ends, no rounding.
 */
const HANDLES = [
  { cls: "sort-handle-1", x: 8, y: 6 },
  { cls: "sort-handle-2", x: 16, y: 12 },
  { cls: "sort-handle-3", x: 11, y: 18 },
] as const;

/** Half-height of a handle — short strokes that clear the track by a little. */
const HALF = 2.5;
/** Distance from handle to its gap = one stroke width, so the gap reads as one. */
const GAP = 2;

export function SortSlidersIcon({ className }: { className?: string }) {
  const maskId = useId();

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
      aria-hidden="true"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        {/* White keeps, black knocks out. */}
        <rect x="0" y="0" width="24" height="24" fill="white" />
        {HANDLES.map(({ cls, x, y }) => (
          <line
            key={cls}
            className={`sort-handle ${cls}`}
            x1={x - GAP}
            y1={y - HALF}
            x2={x - GAP}
            y2={y + HALF}
            stroke="black"
            strokeWidth={2}
            strokeLinecap="butt"
          />
        ))}
      </mask>

      {/* Tracks, with the moving gaps cut out of them. */}
      <g mask={`url(#${maskId})`}>
        <line x1="3" y1="6" x2="21" y2="6" strokeLinecap="round" />
        <line x1="3" y1="12" x2="21" y2="12" strokeLinecap="round" />
        <line x1="3" y1="18" x2="21" y2="18" strokeLinecap="round" />
      </g>

      {/* Handles — the "selected value" on each track. */}
      {HANDLES.map(({ cls, x, y }) => (
        <line
          key={cls}
          className={`sort-handle ${cls}`}
          x1={x}
          y1={y - HALF}
          x2={x}
          y2={y + HALF}
          strokeLinecap="butt"
        />
      ))}
    </svg>
  );
}
