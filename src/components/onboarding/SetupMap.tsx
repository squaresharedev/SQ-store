import type { CSSProperties } from "react";
import { Check } from "lucide-react";
import type { SetupStep, SetupStepId } from "@/lib/onboarding/steps";
import { cn } from "@/lib/utils";

/**
 * THE SETUP MAP: the "Get set up" card's transit line, beside its list of
 * steps. Decoration: aria-hidden throughout, the list says it all in words.
 *
 * After Vignelli's 1972 New York subway map: a heavy line running down the
 * column with a rounded jog between stations, a station level with each step's
 * row. Green where the seller has been, ink on the stretch to the step to take
 * now, grey beyond. A station is a white dot set into the line; once its step
 * is done it becomes a green disc with a tick.
 *
 * Laid out in CSS alone, so it renders on the server and never measures: each
 * row draws the stretch from its own station down to the next one's, and every
 * row puts its station at the same offset, so the next station is exactly one
 * row height further down whatever that height is. A stretch is two straight
 * runs that share whatever height the row has, with a fixed-size jog between.
 */

/** A station's centre, down from the top of its row: the row's divider (1px),
 *  its py-3 and half the label's 1.25rem line, so it sits level with the label.
 *  The same in every row, or the line would miss the stations. */
export const MAP_ROW_PAD_CLASS = "py-3";
const STATION_TOP_CLASS = "top-[calc(1.375rem+1px)]";

/** The line's column (`--map`) and the gap after it (`--map-gap`). */
export const MAP_WIDTH_CLASS = "[--map:3.5rem] [--map-gap:0.75rem]";

type StationLook = "done" | "current" | "todo";

/** A stretch between two stations: walked (both ends done), the one to walk
 *  now (it leads to the current station), or still ahead. */
type LineState = "done" | "next" | "todo";

/* ---------------------------------------------------------------------------
 * The "just done" moment
 * ------------------------------------------------------------------------- */

/** In ms (the keyframes are in globals.css, "setup checklist: a step seen done
 *  for the first time"). A beat after the card comes into view, the stretch
 *  into a fresh station fills, then the station pops; several go one after
 *  another, and last of all the station that is now current takes over. */
const MOMENT_START_MS = 300;
const LINE_FILL_MS = 500; // = .setup-leg-draw's duration
const MOMENT_GAP_MS = 420;

/** Long enough for four fresh steps and the hand-over to finish playing, after
 *  which the caller can stop marking them fresh (so folding and unfolding the
 *  card does not replay them). */
export const SETUP_ANIMATION_SETTLE_MS = 5000;

/** One station's change on screen: from how it looked `from`, at `at`, with the
 *  stretch into it filling from `lineAt` (when it fills at all). */
export type MapMoment = { from: StationLook; at: number; lineAt: number | null };

/**
 * What plays for which station. A FRESH step (done since this device last
 * looked) goes from its old look (current, when it was the step to take, else
 * plain) to done; then, if the current step moved, the new current station
 * takes over. Nothing plays when nothing is fresh.
 */
export function scheduleMoments(
  steps: readonly SetupStep[],
  fresh: readonly SetupStepId[],
): (MapMoment | undefined)[] {
  const moments: (MapMoment | undefined)[] = steps.map(() => undefined);
  if (fresh.length === 0) return moments;
  const current = steps.findIndex((step) => !step.done);
  // Where the line had got to before the fresh steps were done.
  const before = steps.findIndex((step) => !step.done || fresh.includes(step.id));

  let cursor = MOMENT_START_MS;
  steps.forEach((step, index) => {
    if (!fresh.includes(step.id)) return;
    const fills = index > 0 && steps[index - 1].done;
    const at = cursor + (fills ? LINE_FILL_MS - 80 : 0);
    moments[index] = { from: index === before ? "current" : "todo", at, lineAt: fills ? cursor : null };
    cursor = at + MOMENT_GAP_MS;
  });
  if (current >= 0 && current !== before) {
    moments[current] = { from: "todo", at: cursor - 120, lineAt: null };
  }
  return moments;
}

export const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

const OLD_CLASS = "setup-anim setup-fade-out motion-reduce:hidden";
const POP_CLASS = "setup-anim setup-point-pop";

/* ---------------------------------------------------------------------------
 * The per-row cell
 * ------------------------------------------------------------------------- */

/**
 * One row's piece of the line: its station, and the stretch from it down to
 * the next station. `moments` is the whole list's, since the stretch into a
 * station is drawn from the row above it. A station or stretch that is
 * changing is drawn twice: its old pose underneath, giving way, and the new
 * one on top, coming in.
 */
export function MapCell({
  steps,
  index,
  moments,
}: {
  steps: readonly SetupStep[];
  index: number;
  moments: readonly (MapMoment | undefined)[];
}) {
  const current = steps.findIndex((step) => !step.done);
  const look: StationLook = steps[index].done ? "done" : index === current ? "current" : "todo";
  const moment = moments[index];
  const next = moments[index + 1];
  const line: LineState | null =
    index === steps.length - 1
      ? null
      : index + 1 === current
        ? "next"
        : steps[index].done && steps[index + 1].done
          ? "done"
          : "todo";
  const lineMotion =
    line === "done" && next?.lineAt != null
      ? { className: "setup-anim setup-leg-draw", at: next.lineAt, handover: next.lineAt + LINE_FILL_MS }
      : line === "next" && next
        ? { className: "setup-anim setup-fade-in", at: Math.max(0, next.at - 150), handover: next.at }
        : null;
  // Stations alternate left (0) and right (1) of the column's centre.
  const side = (index % 2) as 0 | 1;
  const toSide = ((index + 1) % 2) as 0 | 1;

  return (
    <div aria-hidden className="relative">
      {line && lineMotion && (
        <Line state="todo" fromSide={side} toSide={toSide} className={OLD_CLASS} style={delay(lineMotion.handover)} old />
      )}
      {line && (
        <Line
          state={line}
          fromSide={side}
          toSide={toSide}
          className={lineMotion?.className}
          style={lineMotion ? delay(lineMotion.at) : undefined}
        />
      )}
      {moment && (
        <Station look={moment.from} side={side} className={OLD_CLASS} style={delay(moment.at)} old />
      )}
      <Station
        look={look}
        side={side}
        className={moment ? POP_CLASS : undefined}
        style={moment ? delay(moment.at) : undefined}
        checkStyle={moment ? delay(moment.at + 120) : undefined}
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * The line
 * ------------------------------------------------------------------------- */

/** Stations sit this far either side of the column's centre; the line jogs
 *  between them, so the jog is twice this tall. */
const OFFSET = 11;
const JOG = OFFSET * 2;
/** The line's weight: Vignelli's bold bands. */
const WIDTH = 6;
const stationLeft = (side: 0 | 1) => `calc(50% ${side === 0 ? "-" : "+"} ${OFFSET}px)`;

const LINE_TONE: Record<LineState, string> = {
  done: "text-success",
  next: "text-foreground",
  // Faded as a whole, not by a translucent colour: the runs and the jog
  // overlap at the bends, and a translucent colour darkens every overlap.
  todo: "text-muted-foreground opacity-30",
};

function Line({
  state,
  fromSide,
  toSide,
  className,
  style,
  old,
}: {
  state: LineState;
  fromSide: 0 | 1;
  toSide: 0 | 1;
  className?: string;
  style?: CSSProperties;
  /** The old pose drawn under a changing stretch. */
  old?: boolean;
}) {
  const x = (side: 0 | 1) => (side === 0 ? WIDTH : WIDTH + JOG);
  const a = x(fromSide);
  const b = x(toSide);
  // An S-bend from one run to the next, its ends tucked into the straight runs.
  const bend = `M ${a} -2 L ${a} 0 C ${a} ${JOG * 0.55}, ${b} ${JOG * 0.45}, ${b} ${JOG} L ${b} ${JOG + 2}`;
  const run = (side: 0 | 1) => (
    <span
      className="flex-1 -translate-x-1/2 bg-current"
      style={{ marginLeft: stationLeft(side), width: WIDTH }}
    />
  );

  return (
    <span
      data-setup-leg={old ? undefined : state}
      data-setup-leg-old={old ? state : undefined}
      className={cn("absolute inset-x-0 flex h-full flex-col", STATION_TOP_CLASS, LINE_TONE[state], className)}
      style={style}
    >
      {run(fromSide)}
      <svg
        viewBox={`0 0 ${JOG + WIDTH * 2} ${JOG}`}
        className="mx-auto shrink-0 overflow-visible"
        style={{ width: JOG + WIDTH * 2, height: JOG }}
      >
        <path d={bend} fill="none" stroke="currentColor" strokeWidth={WIDTH} strokeLinejoin="round" />
      </svg>
      {run(toSide)}
    </span>
  );
}

/* ---------------------------------------------------------------------------
 * Stations
 * ------------------------------------------------------------------------- */

/** A white dot set into the line: bolder for the step to take, smaller and
 *  greyer for what is ahead, a green disc with a tick once done. */
const STATION: Record<StationLook, string> = {
  done: "size-5 bg-success text-background",
  current: "size-4 border-[3px] border-foreground bg-background",
  todo: "size-3 border-[3px] border-muted-foreground/30 bg-background",
};

function Station({
  look,
  side,
  className,
  style,
  checkStyle,
  old,
}: {
  look: StationLook;
  side: 0 | 1;
  className?: string;
  style?: CSSProperties;
  /** The tick's own delay, when it pops in after the station. */
  checkStyle?: CSSProperties;
  /** The old pose drawn under a changing station. */
  old?: boolean;
}) {
  return (
    <span
      data-setup-point={old ? undefined : look}
      data-setup-point-old={old ? look : undefined}
      className={cn(
        "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
        STATION_TOP_CLASS,
        STATION[look],
        className,
      )}
      style={{ left: stationLeft(side), ...style }}
    >
      {look === "done" && (
        <Check
          className={cn("size-3", checkStyle && "setup-anim setup-check-pop")}
          style={checkStyle}
          strokeWidth={3.5}
        />
      )}
    </span>
  );
}
