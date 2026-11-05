import type { CSSProperties } from "react";
import { CornerArt } from "@/components/ui/CornerArt";

const WIDTH = 170;
const HEIGHT = 100;
/** Where the bell hangs from the card's top edge: far enough right that its
 *  outer ring on that side runs off the card. */
const X = 120;
/** The crown it hangs by, the body's shoulder and rim, and its half-width at
 *  the rim. */
const CROWN = 16;
const SHOULDER = 21;
const RIM = 62;
const HALF = 28;
/** The clapper's pivot inside the bell, and its ball under the rim. */
const CLAPPER_PIVOT = 40;
const CLAPPER = 70;
/** The rings spread from the bell's middle: an inner and an outer, either
 *  side. */
const RING_CENTRE = 44;
const RINGS = [48, 62];
const RING_SPREAD = 22;
/** One ring of the bell, and the quiet after it. */
const LOOP_MS = 4600;
/** The outer ring a beat after the inner. */
const RING_LAG_MS = 140;

const BELL =
  `M ${X} ${SHOULDER} ` +
  `C ${X - 15} ${SHOULDER}, ${X - 19} ${SHOULDER + 11}, ${X - 19} ${SHOULDER + 22} ` +
  `C ${X - 19} ${SHOULDER + 32}, ${X - 23} ${RIM - 5}, ${X - HALF} ${RIM} ` +
  `L ${X + HALF} ${RIM} ` +
  `C ${X + 23} ${RIM - 5}, ${X + 19} ${SHOULDER + 32}, ${X + 19} ${SHOULDER + 22} ` +
  `C ${X + 19} ${SHOULDER + 11}, ${X + 15} ${SHOULDER}, ${X} ${SHOULDER} Z`;

/** A ring's arc on one side, `spread` degrees either side of `facing`. */
function ring(radius: number, facing: number): string {
  const at = (degrees: number) => {
    const radians = (degrees * Math.PI) / 180;
    return `${X + radius * Math.cos(radians)} ${RING_CENTRE + radius * Math.sin(radians)}`;
  };
  return `M ${at(facing - RING_SPREAD)} A ${radius} ${radius} 0 0 1 ${at(facing + RING_SPREAD)}`;
}

/** Turned about a point in the drawing, not the element's own box. */
const pivot = (x: number, y: number): CSSProperties => ({
  transformBox: "view-box",
  transformOrigin: `${x}px ${y}px`,
});

/**
 * A BELL THAT RINGS, for notifications: it hangs from the card's top edge by
 * its cord, swings, and its clapper strikes, sending rings out either side,
 * the outer ones off the card's right edge. Then it settles and waits.
 */
export function RingingBell({ className }: { className?: string }) {
  return (
    <CornerArt
      name="ringing-bell"
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
        className="absolute inset-0 overflow-visible"
      >
        {RINGS.map((radius, index) => (
          <g
            key={radius}
            className="corner-bell-ring stroke-foreground"
            strokeWidth={3}
            style={{ ...pivot(X, RING_CENTRE), opacity: 0, animationDelay: `${index * RING_LAG_MS}ms` }}
          >
            <path d={ring(radius, 180)} />
            <path d={ring(radius, 0)} />
          </g>
        ))}
        <g className="corner-bell-swing" style={pivot(X, 0)}>
          <path d={`M ${X} -4 V ${CROWN - 4}`} className="stroke-foreground" strokeWidth={3} />
          <circle cx={X} cy={CROWN} r={4} className="fill-background stroke-foreground" strokeWidth={3} />
          <g className="corner-bell-clapper" style={pivot(X, CLAPPER_PIVOT)}>
            <path d={`M ${X} ${CLAPPER_PIVOT} V ${CLAPPER - 4}`} className="stroke-foreground" strokeWidth={2.5} />
            <circle cx={X} cy={CLAPPER} r={5} className="fill-foreground" />
          </g>
          <path d={BELL} className="fill-background stroke-foreground" strokeWidth={4} />
          <path d={`M ${X - HALF - 2} ${RIM} H ${X + HALF + 2}`} className="stroke-foreground" strokeWidth={5} />
        </g>
      </svg>
    </CornerArt>
  );
}
