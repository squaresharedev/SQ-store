import { motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, SETTLE } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Payments: the card tips a little and throws off a sparkle, then lies back
 * down when you leave.
 */
const CARD_TILT: Variants = {
  idle: { rotate: 0, transition: SETTLE },
  hover: {
    // Overshoots a degree and settles, so it reads as the card being tipped
    // rather than simply arriving at an angle.
    rotate: [0, -8, -6],
    transition: { duration: 0.32, ease: EASE_ENTRANCE },
  },
};

/**
 * One twinkle: pops past full size, holds a beat, then goes out.
 *
 * Keyframes are evenly spaced on purpose. Motion runs plain opacity on the
 * browser's animation engine and scale on its own, and only the latter honours
 * a custom `times` array, so a sparkle with custom timing would fade out of
 * step with its own pop.
 */
function sparkleVariants(delay: number, duration: number): Variants {
  return {
    // Leaving mid-pop snuffs the sparkle rather than rewinding it.
    idle: { scale: 0, opacity: 0, transition: { duration: 0.12 } },
    hover: {
      scale: [0, 1.15, 1, 0],
      opacity: [0, 1, 1, 0],
      transition: { delay, duration, ease: EASE_ENTRANCE },
    },
  };
}

/**
 * A four-point star: points on the axes, each side pulled right back to the
 * centre so the arms taper. Drawn rather than crossed strokes, which read as a
 * plus sign at this size.
 */
function star(cx: number, cy: number, r: number): string {
  const q = `Q${cx} ${cy} `;
  return (
    `M${cx} ${cy - r}` +
    `${q}${cx + r} ${cy}` +
    `${q}${cx} ${cy + r}` +
    `${q}${cx - r} ${cy}` +
    `${q}${cx} ${cy - r}Z`
  );
}

// Off the corner the tip lifts, biggest first, the smaller two chasing it.
const SPARKLES: Array<{
  d: string;
  strokeWidth: number;
  variants: Variants;
}> = [
  {
    d: star(22.9, 2.1, 2.7),
    strokeWidth: 1.5,
    variants: sparkleVariants(0.1, 0.55),
  },
  {
    d: star(18.3, 0.7, 1.8),
    strokeWidth: 1.3,
    variants: sparkleVariants(0.2, 0.5),
  },
  {
    d: star(25, 6.6, 1.7),
    strokeWidth: 1.3,
    variants: sparkleVariants(0.28, 0.45),
  },
];

export function PaymentsIcon({ className }: NavIconProps) {
  return (
    <IconSvg className={className}>
      {/* Card and stripe tip as one; separate siblings drift apart. */}
      <motion.g variants={CARD_TILT}>
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <line x1="2" x2="22" y1="10" y2="10" />
      </motion.g>

      {/* The sparkles are furniture the hover brings with it: opacity 0 sits on
          the element itself, not just in the idle variant, so the resting glyph
          is the plain lucide card even where no variant label ever reaches
          them (reduced motion, or an icon rendered outside a nav row). */}
      {SPARKLES.map(({ d, strokeWidth, variants }, i) => (
        <motion.path
          key={i}
          variants={variants}
          d={d}
          opacity={0}
          strokeWidth={strokeWidth}
        />
      ))}
    </IconSvg>
  );
}
