import { useId } from "react";
import { cubicBezier, motion, type Variants } from "motion/react";
import { IconSvg } from "./IconSvg";
import { EASE_ENTRANCE, EASE_EXIT } from "./motion-tokens";
import type { NavIconProps } from "./types";

/**
 * Analytics: lucide's "trending-up" glyph weaves out and back in along its own
 * line.
 *
 * The arrow is a snake of fixed length on a track that is its own zigzag,
 * extended off the icon at both ends. On hover it speeds up along the track
 * and threads out of the top-right corner, head first, the line following
 * through the same corners; then a new run feeds in from the bottom-left and
 * slows to a stop exactly where it began, the line alone, with the arrowhead
 * popping in only once the line has reached the tip. The head turns at every
 * corner it passes on the way out, so it travels the zigzag rather than
 * sliding as one rigid piece.
 *
 * Everything is driven by one sampled speed profile (the exit accelerates, the
 * entry decelerates) so the head, the line and the fade all stay in step. The
 * icon box is a clip, so what is past its edge simply is not drawn.
 *
 * Wind streaks sit at zero opacity at rest, so the icon is untouched until
 * hover. Their keyframes are evenly spaced on purpose: motion runs plain
 * opacity on the browser's animation engine and transforms on its own, and
 * only the latter honours a custom `times` array, so a streak with custom
 * timing would fade out of step with its own flight.
 */

type Point = readonly [number, number];

/** The resting glyph's line, then the off-icon runways it threads along. */
const RUNWAY_IN = 32; // runway before the first vertex, down-left of the icon
const RUNWAY_OUT = 33; // runway past the arrow tip, up-right of the icon
const TIP: Point = [22, 7];
const CORNERS: Point[] = [[2, 17], [8.5, 10.5], [13.5, 15.5], TIP];
const DIAGONAL = Math.SQRT1_2;
const TRACK: Point[] = [
  [CORNERS[0][0] - RUNWAY_IN * DIAGONAL, CORNERS[0][1] + RUNWAY_IN * DIAGONAL],
  ...CORNERS,
  [TIP[0] + RUNWAY_OUT * DIAGONAL, TIP[1] - RUNWAY_OUT * DIAGONAL],
];

const segLength = (a: Point, b: Point) => Math.hypot(b[0] - a[0], b[1] - a[1]);
/** Distance along the track at each vertex. */
const CUM = TRACK.reduce<number[]>(
  (acc, p, i) =>
    i === 0 ? [0] : [...acc, acc[i - 1] + segLength(TRACK[i - 1], p)],
  [],
);
const TRACK_LENGTH = CUM[CUM.length - 1];
/** The resting line, vertex to tip: how much of the track is drawn. */
const LINE_LENGTH = CUM[CUM.length - 2] - CUM[1];
const REST_HEAD = CUM[CUM.length - 2];

/** Heading of each segment, in degrees clockwise from the resting up-right. */
const HEADING = TRACK.slice(1).map((p, i) => {
  const [x0, y0] = TRACK[i];
  return (Math.atan2(p[1] - y0, p[0] - x0) * 180) / Math.PI + 45;
});
/** How far either side of a corner the head takes to swing round it. */
const TURN = 1.2;

function pointAt(distance: number) {
  let i = 1;
  while (i < CUM.length - 1 && distance > CUM[i]) i += 1;
  const [x0, y0] = TRACK[i - 1];
  const [x1, y1] = TRACK[i];
  const f = (distance - CUM[i - 1]) / (CUM[i] - CUM[i - 1]);
  let heading = HEADING[i - 1];
  for (let k = 1; k < CUM.length - 1; k += 1) {
    const away = distance - CUM[k];
    if (Math.abs(away) < TURN) {
      heading =
        HEADING[k - 1] +
        ((HEADING[k] - HEADING[k - 1]) * (away + TURN)) / (2 * TURN);
    }
  }
  return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, heading };
}

/** Where the head sits when it is fully off the icon at each end. */
const HEAD_GONE_OUT = REST_HEAD + LINE_LENGTH + 4;
const HEAD_GONE_IN = CUM[1] - 3.2;

const SAMPLES = 72;
/** Fractions of the run: the exit, a hidden beat, then the entry. */
const EXIT_END = 0.38;
const ENTRY_START = 0.44;
const DURATION = 0.75;

const exitCurve = cubicBezier(...EASE_EXIT);
const entryCurve = cubicBezier(...EASE_ENTRANCE);

/** Head distance along the track at a fraction of the run, and whether it shows. */
function headAt(t: number) {
  if (t <= EXIT_END) {
    const f = exitCurve(t / EXIT_END);
    return { head: REST_HEAD + (HEAD_GONE_OUT - REST_HEAD) * f, shown: true };
  }
  if (t < ENTRY_START) {
    return { head: HEAD_GONE_OUT, shown: false };
  }
  const f = entryCurve((t - ENTRY_START) / (1 - ENTRY_START));
  return { head: HEAD_GONE_IN + (REST_HEAD - HEAD_GONE_IN) * f, shown: true };
}

/** The entering line is this close to the tip before the arrowhead shows. */
const REVEAL_GAP = 0.5;
/** Samples the arrowhead takes to pop in once the line has arrived. */
const REVEAL_SAMPLES = 4;
/** The scale the arrowhead pops in from, about its tip. */
const REVEAL_FROM = 0.4;

const RUN = Array.from({ length: SAMPLES }, (_, i) => {
  const t = i / (SAMPLES - 1);
  const { head: runHead, shown } = headAt(t);
  // Park the head at the start runway for the hidden beat's second half, so
  // the jump between the two ends happens while nothing is drawn.
  const head =
    !shown && t > (EXIT_END + ENTRY_START) / 2 ? HEAD_GONE_IN : runHead;
  return { t, head, shown };
});
/** The first sample at which the entering line has reached the tip. */
const ARRIVED = RUN.findIndex(
  ({ t, head }) => t >= ENTRY_START && REST_HEAD - head <= REVEAL_GAP,
);

const FRAMES = RUN.map(({ t, head, shown }, i) => {
  const p = pointAt(head);
  // The arrowhead leads the line out, but on the way back in only the line
  // comes: the tip appears once the line has reached it.
  const reveal =
    t < ENTRY_START
      ? 1
      : Math.min(Math.max((i - ARRIVED) / REVEAL_SAMPLES, 0), 1);
  return {
    x: p.x - TIP[0],
    y: p.y - TIP[1],
    rotate: p.heading,
    offset: (head - LINE_LENGTH) / TRACK_LENGTH,
    opacity: shown ? 1 : 0,
    headOpacity: reveal > 0 ? 1 : 0,
    headScale: REVEAL_FROM + (1 - REVEAL_FROM) * reveal,
  };
});
const channel = (key: keyof (typeof FRAMES)[number]) =>
  FRAMES.map((frame) => frame[key]);

const SNAKE: Variants = {
  idle: { opacity: 1, transition: { duration: 0 } },
  hover: {
    opacity: channel("opacity"),
    transition: { duration: DURATION, ease: "linear" },
  },
};

/**
 * The line draws only its own stretch of the track: a window of the resting
 * line's length that starts at the first vertex. Motion expresses it as path
 * length and offset (fractions of the whole track), which only exist as
 * animated values, hence a resting state of its own rather than attributes.
 */
const LINE_REST = {
  pathLength: LINE_LENGTH / TRACK_LENGTH,
  pathOffset: CUM[1] / TRACK_LENGTH,
};

const LINE: Variants = {
  idle: { ...LINE_REST, transition: { duration: 0 } },
  hover: {
    pathLength: LINE_REST.pathLength,
    pathOffset: channel("offset"),
    transition: { duration: DURATION, ease: "linear" },
  },
};

const HEAD: Variants = {
  idle: {
    x: 0,
    y: 0,
    rotate: 0,
    scale: 1,
    opacity: 1,
    transition: { duration: 0 },
  },
  hover: {
    x: channel("x"),
    y: channel("y"),
    rotate: channel("rotate"),
    scale: channel("headScale"),
    opacity: channel("headOpacity"),
    transition: { duration: DURATION, ease: "linear" },
  },
};

/** One gust trailing down the slope, timed to the arrow's take-off. */
function streak(delay: number, distance: number): Variants {
  return {
    idle: { x: 0, y: 0, opacity: 0, transition: { duration: 0.1 } },
    hover: {
      x: [0, -distance * 0.4, -distance],
      y: [0, distance * 0.4, distance],
      opacity: [0, 0.95, 0],
      transition: { delay, duration: 0.22, ease: EASE_ENTRANCE },
    },
  };
}

/** A streak lying along the arrow's slope, trailing down and to the left. */
const dash = (x: number, y: number, length = 1.7) =>
  `M${x} ${y}l-${length} ${length}`;

const STREAKS: Array<{ d: string; variants: Variants }> = [
  { d: dash(22.5, 11.5), variants: streak(0.07, 7) },
  { d: dash(21, 15, 2.1), variants: streak(0.1, 8) },
  { d: dash(12, 3, 2.1), variants: streak(0.11, 8) },
  { d: dash(23, 16), variants: streak(0.14, 7) },
  { d: dash(8.5, 5.5), variants: streak(0.15, 7) },
  { d: dash(18.5, 16), variants: streak(0.18, 7) },
];

const TRACK_PATH = TRACK.map(
  ([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`,
).join("");

export function AnalyticsIcon({ className }: NavIconProps) {
  // Per instance: the rail and a gallery can both draw it, and a clip defined
  // inside a hidden copy would not apply to the visible one.
  const clipId = useId();
  return (
    <IconSvg className={className}>
      <defs>
        <clipPath id={clipId}>
          <rect width="24" height="24" />
        </clipPath>
      </defs>

      {/* Opacity 0 on the element itself, not just in the idle variant, so the
          resting glyph is the plain lucide arrow even where no variant label
          ever reaches the streaks (reduced motion). */}
      {STREAKS.map(({ d, variants }, i) => (
        <motion.path key={i} variants={variants} d={d} opacity={0} />
      ))}

      <g clipPath={`url(#${clipId})`}>
        <motion.g variants={SNAKE}>
          {/* Only the arrow's own stretch of the track is drawn; the window
              slides along it. At rest it is exactly the glyph's line. */}
          <motion.path variants={LINE} initial={LINE_REST} d={TRACK_PATH} />
          <motion.path
            variants={HEAD}
            d="M16 7h6v6"
            style={{ originX: 1, originY: 0 }}
          />
        </motion.g>
      </g>
    </IconSvg>
  );
}
