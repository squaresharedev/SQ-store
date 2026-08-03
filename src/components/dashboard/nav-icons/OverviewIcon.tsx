import { useId, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_STANDARD } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Overview: the two columns of the dashboard counter-scroll like split-flap
 * boards. The left column rides down, the right rides up, blocks are cut off
 * at the glyph's edge, and a fresh block slides in behind each one.
 *
 * The ride is a one-shot: once a hover starts it plays all the way through
 * and stays where it lands, so taking the pointer away mid-ride never yanks
 * the blocks backwards.
 *
 * One column period is tall(9) + gap(4) + short(5) + gap(4). Travelling
 * exactly that far lands every block on a slot of its own shape, so the frame
 * the ride ends on is identical to the resting icon: each column carries two
 * off-screen understudies waiting to take the visible slots. That is what
 * makes the snap back to zero at the end invisible, and it is what lets the
 * next hover ride again without the strip running out of blocks.
 *
 * Rides are counted against hovers rather than driven by a hovered flag, so
 * the cycle cannot wedge: however many hovers arrive, and whatever happens to
 * the pointer-leave events, a hover that has not been ridden yet still rides.
 */
const PERIOD = 22;

const RIDE = { duration: 0.5, ease: EASE_STANDARD };
const SNAP_BACK = { duration: 0 };

export function OverviewIcon({ className, hoverCount = 0 }: NavIconProps) {
  const reducedMotion = useReducedMotion();
  const [ridden, setRidden] = useState(0);

  const riding = !reducedMotion && hoverCount > ridden;
  const offset = riding ? PERIOD : 0;
  const transition = riding ? RIDE : SNAP_BACK;

  // Sanitised because useId() ships colons, which are legal in an id but
  // hostile to a url(#...) reference.
  const clipId = `nav-overview-${useId().replace(/:/g, "")}`;

  return (
    <IconSvg className={className}>
      <defs>
        <clipPath id={clipId}>
          {/* The glyph's own bounds. Blocks entering or leaving a column are
              cut here; at rest every real block clears it with room to spare
              and every understudy sits fully outside it. */}
          <rect x="1" y="1" width="22" height="22" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        {/* Left column rides down, so its understudies queue up above. */}
        <motion.g
          animate={{ y: offset }}
          transition={transition}
          // Marks every outstanding hover as ridden, so a burst of hovers
          // during one ride settles the count instead of queueing rides that
          // would have nothing left to travel through.
          onAnimationComplete={() => setRidden(hoverCount)}
        >
          <rect width="7" height="9" x="3" y="-19" rx="1" />
          <rect width="7" height="5" x="3" y="-6" rx="1" />
          <rect width="7" height="9" x="3" y="3" rx="1" />
          <rect width="7" height="5" x="3" y="16" rx="1" />
        </motion.g>

        {/* Right column rides up, so its understudies queue up below. */}
        <motion.g animate={{ y: -offset }} transition={transition}>
          <rect width="7" height="5" x="14" y="3" rx="1" />
          <rect width="7" height="9" x="14" y="12" rx="1" />
          <rect width="7" height="5" x="14" y="25" rx="1" />
          <rect width="7" height="9" x="14" y="34" rx="1" />
        </motion.g>
      </g>
    </IconSvg>
  );
}
