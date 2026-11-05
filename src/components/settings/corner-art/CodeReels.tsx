import type { CSSProperties } from "react";
import { CornerArt } from "@/components/ui/CornerArt";

const WIDTH = 226;
/** A digit's row on a reel. */
const ROW = 26;
const DIGITS = 6;
const REEL_WIDTH = 24;
const REEL_GAP = 6;
const FIELD_PAD = 10;
/** The code field the reels stop in, clear of the card's right edge by the
 *  card's own padding. */
const FIELD = {
  left: 4,
  top: 36,
  width: DIGITS * REEL_WIDTH + (DIGITS - 1) * REEL_GAP + FIELD_PAD * 2,
  height: ROW + 12,
};
const FIELD_BOTTOM = FIELD.top + FIELD.height;
/** The picture ends with the field: below it the reels are hidden. */
const HEIGHT = FIELD_BOTTOM;
/** The field's border, inset from the clip that shows the inked digits. */
const BORDER = 2;

/** Each reel turns through two codes a loop, half a cycle apart, so the code
 *  it ends on is the one it started on and the loop has no seam. */
const CYCLE = 14;
/** Rows drawn either side of the cycle: the reel carries on above the field,
 *  out through the card's top edge, and is hidden below it. */
const PAD = 3;
/** The reel's top, with the cycle's first code in the field. */
const STRIP_TOP = FIELD.top + FIELD.height / 2 - ROW / 2 - PAD * ROW;
const LOOP_MS = 6400;
/** The reels start left to right, each a beat after the one before. */
const STAGGER_MS = 90;

/** The two codes a loop lands on. */
const CODES = ["482637", "915204"];

/** Each reel's digits: its share of the two codes half a cycle apart, fixed
 *  pseudo-random digits spinning past between them, and padded with its own
 *  ends so it wraps without a jump. */
const REELS = Array.from({ length: DIGITS }, (_, reel) => {
  let seed = (reel + 1) * 7919;
  const cycle = Array.from({ length: CYCLE }, (_, row) => {
    seed = (seed * 48271) % 2147483647;
    if (row === 0) return CODES[0][reel];
    if (row === CYCLE / 2) return CODES[1][reel];
    return String(seed % 10);
  });
  return [...cycle.slice(-PAD), ...cycle, ...cycle.slice(0, PAD)];
});

function Reels() {
  return REELS.map((digits, reel) => (
    <span
      key={reel}
      className="corner-reel absolute flex flex-col font-mono text-lg font-semibold tabular-nums"
      style={{
        left: FIELD.left + FIELD_PAD + reel * (REEL_WIDTH + REEL_GAP),
        top: STRIP_TOP,
        width: REEL_WIDTH,
        animationDelay: `${reel * STAGGER_MS}ms`,
      }}
    >
      {digits.map((digit, row) => (
        <span key={row} className="flex items-center justify-center" style={{ height: ROW }}>
          {digit}
        </span>
      ))}
    </span>
  ));
}

/**
 * A CODE ROLLING IN, for two-factor sign-in: six slot reels of digits roll up
 * out of the field and on through the card's top edge, and stop, left to
 * right, on a code. A moment later they spin on to the next code. Faint grey
 * above the field, ink inside it.
 */
export function CodeReels({ className }: { className?: string }) {
  // Clear at the card's top edge, solid by the field (a straight ramp, so the
  // digits strengthen as they roll down into it), and gone again under it.
  const fade = `linear-gradient(to bottom, transparent, #000 ${FIELD.top}px, transparent ${FIELD_BOTTOM}px)`;
  return (
    <CornerArt
      name="code-reels"
      width={WIDTH}
      height={HEIGHT}
      className={className}
      style={
        {
          "--corner-loop": `${LOOP_MS}ms`,
          "--reel-spin": `${(-ROW * CYCLE) / 2}px`,
        } as CSSProperties
      }
    >
      <span
        className="absolute inset-0 text-muted-foreground"
        style={{ WebkitMaskImage: fade, maskImage: fade }}
      >
        <Reels />
      </span>
      <span
        className="absolute border-2 border-foreground"
        style={{ left: FIELD.left, top: FIELD.top, width: FIELD.width, height: FIELD.height }}
      />
      <span
        className="absolute inset-0 text-foreground"
        style={{
          clipPath: `inset(${FIELD.top + BORDER}px ${WIDTH - FIELD.left - FIELD.width + BORDER}px ${HEIGHT - FIELD_BOTTOM + BORDER}px ${FIELD.left + BORDER}px)`,
        }}
      >
        <Reels />
      </span>
    </CornerArt>
  );
}
