/**
 * THE TRANSIT LINE: the setup checklist's map vocabulary (after Vignelli's
 * 1972 New York subway map), shared so every line of stations in the app is
 * drawn the same way: a heavy band with rounded S-bend jogs, and white dots
 * set into it for stations. onboarding/SetupMap draws the checklist with it;
 * ui/TransitFlow draws the small looping route on cards.
 */

/** The line's weight: Vignelli's bold bands. */
export const TRANSIT_LINE_WIDTH = 6;

/** Stations sit this far either side of the line's centre; the line jogs
 *  between them, so a jog is twice this tall. */
export const TRANSIT_OFFSET = 11;
export const TRANSIT_JOG = TRANSIT_OFFSET * 2;

/** A stretch between two stations: walked, the one to walk now, or still
 *  ahead. */
export type TransitLineState = "done" | "next" | "todo";

export const TRANSIT_LINE_TONE: Record<TransitLineState, string> = {
  done: "text-success",
  next: "text-foreground",
  // Faded as a whole, not by a translucent colour: the runs and the jog
  // overlap at the bends, and a translucent colour darkens every overlap.
  todo: "text-muted-foreground opacity-30",
};

export type TransitStationLook = "done" | "current" | "todo";

/** A white dot set into the line: bolder for the step to take, smaller and
 *  greyer for what is ahead, a green disc (with a tick, drawn by the caller)
 *  once done. */
export const TRANSIT_STATION: Record<TransitStationLook, string> = {
  done: "size-5 bg-success text-background",
  current: "size-4 border-[3px] border-foreground bg-background",
  todo: "size-3 border-[3px] border-muted-foreground/30 bg-background",
};

/**
 * The S-bend from one run to the next, as an SVG cubic to append after a
 * point on the first run. It eases off that run, crosses from `from` to `to`
 * and eases onto the next over one jog. Points are given as (along, across)
 * the line, and `point` lays them out as "x y" for the line's direction, so
 * the map (running down the page) and a route (running across it) share one
 * curve.
 */
export function transitBend(
  along: number,
  from: number,
  to: number,
  point: (along: number, across: number) => string,
): string {
  return `C ${point(along + TRANSIT_JOG * 0.55, from)}, ${point(along + TRANSIT_JOG * 0.45, to)}, ${point(along + TRANSIT_JOG, to)}`;
}
