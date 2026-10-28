import type { CSSProperties } from "react";
import {
  TRANSIT_JOG,
  TRANSIT_LINE_TONE,
  TRANSIT_LINE_WIDTH,
  TRANSIT_OFFSET,
  TRANSIT_STATION,
  transitBend,
} from "@/components/ui/transit-styles";
import { cn } from "@/lib/utils";

/* Laid out at the setup map's own size, then drawn SCALE times bigger, so the
   line, the stations and their rings keep the map's proportions exactly. */

/** How much bigger than the setup map the route is drawn. */
const SCALE = 1.5;
/** The straight run either side of a station, before the line bends away. */
const RUN = 16;
/** Station to station: a run, a jog, a run. */
const SPAN = RUN * 2 + TRANSIT_JOG;
/** Where the line comes straight down off the top edge, from the left. */
const LEAD_X = TRANSIT_LINE_WIDTH;
/** The corner from coming down to running right: tight, so the lead-in reads
 *  as a straight drop with a bend at its foot. */
const TURN = TRANSIT_OFFSET;
/** A quarter circle's control-point reach, as a share of its radius. */
const QUARTER = 0.5523;
/** The upper stations' level, down from the top edge. */
const TOP = 32;
/** The drawing past the last station, up to the right edge that cuts it. */
const TAIL = 18;
/** Room under the lower station for its ring. */
const FOOT = 12;
/** The pill of ink's length. */
const PILL = 18;
/** One run of the pill, in ms, with the stretch it spends off the card. */
const LOOP_MS = 3800;
/** Where the pill starts and how far it goes, in percent of the line: as in
 *  globals.css's transit-flow-run (20 to -100), from wholly before the line's
 *  start to wholly past its end. */
const RUN_FROM = 20;
const RUN_DISTANCE = 120;

/** Three stations stepping down and back up, the way the map alternates. */
const FIRST_X = LEAD_X + TURN + RUN;
const STATIONS = [0, 1, 2].map((index) => ({
  x: FIRST_X + index * SPAN,
  y: TOP + (index % 2 === 0 ? 0 : TRANSIT_JOG),
}));
const [FIRST, MIDDLE, LAST] = STATIONS;
const WIDTH = LAST.x + TAIL;
const HEIGHT = MIDDLE.y + FOOT;

/** The lead-in sits above where the description starts, so the drawing
 *  reaches back that far over the text column without taking its width. */
const OVERHANG = FIRST.x;

const point = (along: number, across: number) => `${along} ${TOP + across}`;
/** The whole line: straight down through the top edge, a bend at its foot
 *  into the first station's run, the stations, then out through the right
 *  edge. Both ends run one line width past the drawing's edges, which cut
 *  them. */
const TRACK =
  `M ${LEAD_X} ${-TRANSIT_LINE_WIDTH} L ${LEAD_X} ${TOP - TURN} ` +
  `C ${LEAD_X} ${TOP - TURN * (1 - QUARTER)}, ${LEAD_X + TURN * (1 - QUARTER)} ${TOP}, ${LEAD_X + TURN} ${TOP} ` +
  `L ${FIRST.x} ${TOP} ` +
  STATIONS.slice(1)
    .map((to, index) => {
      const from = STATIONS[index];
      const bendAt = from.x + RUN;
      const [a, b] = [from.y - TOP, to.y - TOP];
      return `L ${point(bendAt, a)} ${transitBend(bendAt, a, b, point)} L ${point(to.x, b)}`;
    })
    .join(" ") +
  ` L ${WIDTH + TRANSIT_LINE_WIDTH} ${TOP}`;

type Point = [number, number];

/** A cubic's length, summed along the curve itself. */
function cubicLength([p0, p1, p2, p3]: Point[]): number {
  const at = (t: number, i: 0 | 1) =>
    (1 - t) ** 3 * p0[i] + 3 * (1 - t) ** 2 * t * p1[i] + 3 * (1 - t) * t ** 2 * p2[i] + t ** 3 * p3[i];
  let length = 0;
  for (let step = 1; step <= 64; step++) {
    const [t0, t1] = [(step - 1) / 64, step / 64];
    length += Math.hypot(at(t1, 0) - at(t0, 0), at(t1, 1) - at(t0, 1));
  }
  return length;
}

/** The S-bend's control points, read back out of transitBend so its shape is
 *  never restated here. */
const S_BEND: Point[] = [[0, 0]];
transitBend(0, 0, TRANSIT_JOG, (along, across) => {
  S_BEND.push([along, across]);
  return "";
});

/** Where each station is along the whole line, and the line's length: what
 *  the flashes are timed from. */
const DROP = TOP - TURN + TRANSIT_LINE_WIDTH;
const CORNER = cubicLength([
  [0, 0],
  [0, TURN * QUARTER],
  [TURN * (1 - QUARTER), TURN],
  [TURN, TURN],
]);
const LEG = RUN * 2 + cubicLength(S_BEND);
const FIRST_AT = DROP + CORNER + RUN;
const STATION_AT = [FIRST_AT, FIRST_AT + LEG, FIRST_AT + LEG * 2];
const LENGTH = FIRST_AT + LEG * 2 + TAIL + TRANSIT_LINE_WIDTH;
const PILL_PERCENT = (PILL / LENGTH) * 100;

/** When the pill's middle reaches a station, as a (negative) delay for its
 *  flash, whose keyframes peak at the loop's start. */
function passDelay(at: number): string {
  const share = ((at / LENGTH) * 100 + RUN_FROM - PILL_PERCENT / 2) / RUN_DISTANCE;
  return `${Math.round(share * LOOP_MS - LOOP_MS)}ms`;
}

/**
 * A SMALL ROUTE THAT RUNS, through a card's top-right corner: the setup
 * checklist's line (ui/transit-styles) comes straight down through the card's
 * top edge, bends into three stations stepping down and back up, and runs out
 * through its right edge. A pill of ink runs the whole line on a loop, in past
 * one cut and out past the other. Every station is plain until the pill passes
 * through it, and lights as it does.
 *
 * Grey, black and white, and held back to a faint grey as a whole, so it
 * decorates the corner without competing with the card. Its top and right
 * edges are the cut lines: SettingsCard's `art` sets it flush in the corner.
 * Decoration, so aria-hidden; under reduced motion it is the still line.
 */
export function TransitFlow({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-transit-flow=""
      className={cn("relative block shrink-0", className)}
      style={
        {
          width: (WIDTH - OVERHANG) * SCALE,
          height: HEIGHT * SCALE,
          "--transit-loop": `${LOOP_MS}ms`,
        } as CSSProperties
      }
    >
      <span
        className="absolute right-0 top-0 overflow-hidden opacity-40"
        style={{ width: WIDTH * SCALE, height: HEIGHT * SCALE }}
      >
        <span
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: WIDTH, height: HEIGHT, scale: String(SCALE) }}
        >
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            width={WIDTH}
            height={HEIGHT}
            className="absolute inset-0 overflow-visible"
          >
            <path
              d={TRACK}
              fill="none"
              stroke="currentColor"
              strokeWidth={TRANSIT_LINE_WIDTH}
              strokeLinejoin="round"
              className={TRANSIT_LINE_TONE.todo}
            />
            {/* The pill: one dash on a pathLength-100 copy of the line, so
                the keyframes count in "percent of the way". Its resting pose
                is set HERE, wholly before the line starts, so without the
                animation (reduced motion, or no stylesheet) it is not there. */}
            <path
              d={TRACK}
              pathLength={100}
              fill="none"
              stroke="currentColor"
              strokeWidth={TRANSIT_LINE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${PILL_PERCENT} 200`}
              strokeDashoffset={RUN_FROM}
              className={cn("transit-flow-run", TRANSIT_LINE_TONE.next)}
            />
          </svg>
          {STATIONS.map((station, index) => (
            <Station key={`plain-${index}`} look="todo" {...station} />
          ))}
          {STATIONS.map((station, index) => (
            <Station
              key={`lit-${index}`}
              look="current"
              {...station}
              flashDelay={passDelay(STATION_AT[index])}
            />
          ))}
        </span>
      </span>
    </span>
  );
}

/** A station, centred on its point of the line. A flashing one is a bolder
 *  station drawn over the plain one, hidden until the pill passes. */
function Station({
  look,
  x,
  y,
  flashDelay,
}: {
  look: "current" | "todo";
  x: number;
  y: number;
  flashDelay?: string;
}) {
  return (
    <span
      className={cn(
        "absolute -translate-x-1/2 -translate-y-1/2 rounded-full",
        TRANSIT_STATION[look],
        flashDelay && "transit-flow-pass",
      )}
      style={{
        left: x,
        top: y,
        ...(flashDelay && { opacity: 0, animationDelay: flashDelay }),
      }}
    />
  );
}
