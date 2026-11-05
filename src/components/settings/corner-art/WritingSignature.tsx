import type { CSSProperties } from "react";
import { CornerArt } from "@/components/ui/CornerArt";

const WIDTH = 200;
const HEIGHT = 100;
/** The page: its left edge in the corner, its top and right edges carrying on
 *  past the card's. */
const PAGE = { x: 22, y: -12, bottom: 92 };
/** The text above the signature, as bars, some running off the page's edge. */
const TEXT = [
  { y: 12, width: 150 },
  { y: 22, width: 170 },
  { y: 32, width: 96 },
];
const TEXT_X = 38;
/** The line it is signed on, and the cross that marks it. */
const SIGN_LINE = { y: 80, from: TEXT_X, to: 168 };
const CROSS = { x: 31, y: 74, size: 3 };
/** One signature, a look at it, and a fade before the next. */
const LOOP_MS = 5400;

/** The signature: loops and humps rising to a flourish, above its line. */
const SIGNATURE =
  "M 48 74 C 52 58, 58 46, 64 50 C 70 54, 60 76, 56 72 C 52 68, 68 60, 76 64 " +
  "C 82 67, 78 76, 84 74 C 90 72, 92 58, 98 60 C 104 62, 98 76, 106 74 " +
  "C 114 72, 116 60, 124 62 C 130 64, 126 74, 134 72 C 144 69, 150 58, 162 56";

/**
 * A SIGNATURE BEING WRITTEN, for the terms: a page runs off the card's top and
 * right edges, with its text and a line to sign on. A pen comes down, writes
 * a signature along the line and lifts away; the ink rests a moment, fades,
 * and it is signed again. Without the motion it is the signed page.
 */
export function WritingSignature({ className }: { className?: string }) {
  return (
    <CornerArt
      name="writing-signature"
      width={WIDTH}
      height={HEIGHT}
      className={className}
      style={{ "--corner-loop": `${LOOP_MS}ms` } as CSSProperties}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width={WIDTH}
        height={HEIGHT}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute inset-0"
      >
        <rect
          x={PAGE.x}
          y={PAGE.y}
          width={WIDTH}
          height={PAGE.bottom - PAGE.y}
          rx={4}
          className="fill-background stroke-foreground"
          strokeWidth={2}
        />
        {TEXT.map(({ y, width }) => (
          <rect key={y} x={TEXT_X} y={y} width={width} height={3} rx={1.5} className="fill-muted-foreground" />
        ))}
        <path
          d={`M ${CROSS.x - CROSS.size} ${CROSS.y - CROSS.size} l ${CROSS.size * 2} ${CROSS.size * 2} m 0 ${-CROSS.size * 2} l ${-CROSS.size * 2} ${CROSS.size * 2}`}
          className="stroke-muted-foreground"
          strokeWidth={1.5}
        />
        <path
          d={`M ${SIGN_LINE.from} ${SIGN_LINE.y} H ${SIGN_LINE.to}`}
          className="stroke-foreground"
          strokeWidth={1.5}
        />
        {/* Its still pose is written: the motion only adds the writing. */}
        <path
          d={SIGNATURE}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={0}
          className="corner-sign-ink stroke-foreground"
          strokeWidth={2.5}
        />
      </svg>
      {/* The pen rides the signature's own path, its nib on the ink. */}
      <svg
        viewBox="0 0 20 34"
        width={20}
        height={34}
        className="corner-sign-pen absolute left-0 top-0"
        style={{
          offsetPath: `path("${SIGNATURE}")`,
          offsetAnchor: "0% 100%",
          offsetRotate: "0deg",
          opacity: 0,
        }}
      >
        <path d="M 4 29 L 17 6" className="stroke-foreground" strokeWidth={5} strokeLinecap="round" />
        <path d="M 1 33 L 3 26 L 7 29 Z" className="fill-foreground" />
      </svg>
    </CornerArt>
  );
}
