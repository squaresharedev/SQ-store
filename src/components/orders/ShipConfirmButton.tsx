"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { TRUCK_WHEELS, TruckIcon } from "@/components/ui/action-icons";
import { buttonClassName } from "@/components/ui/button";
import { DURATION, POP, PRESS_SCALE } from "@/components/ui/motion-tokens";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  CLIP_OPEN,
  CLIP_SHUT,
  CONE_LENGTH,
  NO_GEOMETRY,
  cloudPath,
  coneClip,
  journey,
  type Geometry,
} from "./ship-cone";
import { DUST, kickDust } from "./ship-dust";

/**
 * The button that actually ships an order, and the moment of it.
 *
 * Pressed, the button sinks under the finger and springs back, and the truck
 * starts spinning its wheels where it stands, kicking dust up behind it: that
 * is the request in flight, and it runs for as long as the server takes. When
 * the server says yes the truck rocks back on its springs and floors it. The
 * success colour does not sweep in as a flat edge: it streams out from UNDER
 * the van as a cloud, tip at the van and fanning wider behind it, so the button
 * is pulled into "Shipped" by the van rather than repainted. The cloud is made
 * of overlapping discs melted together by a gooey filter (see ship-cone), so
 * its sides are even but never regular and a few blobs part from it and float
 * off. The van sheds dust from its wheels the whole way, and leaves a trail of
 * it. The check draws as the cloud clears and the button pops.
 *
 * The success is only ever shown for a success: the truck does not leave until
 * the order is really marked, and a refusal parks it again with the form still
 * open. The owner (OrderShipping) holds the panel on the finished state for
 * `useShipSequence().holdMs` before it swaps to the shipped view, so the click
 * gets its ending.
 *
 * Reduced motion gets the plain spinner while it waits and the finished state
 * with nothing travelling.
 */

export type ShipState = "idle" | "working" | "delivered";

/**
 * The ship form's action row: the main button takes every px it can, the side
 * button (Cancel) keeps its own size and sits flush with the right edge of the
 * fields above it. Spelled once so the button, the form and the gallery agree.
 */
export const shipActionsClass = "flex gap-2";
export const shipMainActionClass = "min-w-0 flex-1";
export const shipSideActionClass = "shrink-0";

/** The choreography, in seconds. */
export const SHIP_TIMING = {
  /** The least the wheels turn before the truck may leave, so a fast server still shows the wind-up. */
  rev: 0.4,
  /** Rocking back on its springs before it goes. */
  windup: 0.16,
  /** The truck floors it: it leaves the button, and the cloud finishes covering it. */
  drive: 0.72,
  /** The check drawing itself in as the cloud clears. */
  check: 0.28,
  /** Success left standing before the panel moves on. */
  hold: 0.7,
} as const;

const ms = (seconds: number) => Math.round(seconds * 1000);

const SEQUENCE = {
  revMs: ms(SHIP_TIMING.rev),
  rollMs: ms(SHIP_TIMING.windup + SHIP_TIMING.drive),
  holdMs: ms(SHIP_TIMING.hold),
} as const;

/** Nothing travels, so nothing needs waiting for: only the finished state is held. */
const STILL_SEQUENCE = { revMs: 0, rollMs: 0, holdMs: SEQUENCE.holdMs } as const;

/** How long each stage lasts, in milliseconds, for the owner to wait on. */
export function useShipSequence() {
  return useReducedMotion() ? STILL_SEQUENCE : SEQUENCE;
}

/** How far the truck settles back before it goes. */
const WINDUP_PX = 5;
/** How far the success content slides while the cloud uncovers it. */
const SLIDE_PX = 10;
/** Acceleration: slow off the mark, very quick at the end, so it reads as floored. */
const FLOOR_IT = "circIn" as const;
/**
 * The colour layer is drawn this many px larger than the button on every side
 * and run through the gooey filter. A blur pulls in empty pixels at a layer's
 * own border, and that must stay outside the button (which clips it) or the
 * button's real edges would look eaten.
 */
const GOO_MARGIN = 12;
/** How much the discs are blurred before the threshold: the size of the melt between them. */
const GOO_BLUR = 1.8;
/** Sharpens the blurred alpha back into a crisp, rounded edge (the "goo": blur, then threshold). */
const GOO_ALPHA = "0 0 0 16 -7";
/**
 * The words are revealed by a plain cone that trails the coloured one by this
 * many px, so they only ever appear on solid colour: a bump on the cloud's edge
 * never catches a letter half on black.
 */
const TEXT_LAG = 28;
/** The button's little jump as the success lands. */
const LAND_POP_SCALE = 1.06;
const LAND_POP_SECONDS = 0.4;

/** Phone haptics (Vibration API, so Android only): a tick as it launches, a double tap as it lands. */
const HAPTIC = { launch: 10, land: [14, 40, 22] } as const;

function vibrate(pattern: number | readonly number[]) {
  try {
    navigator.vibrate?.(pattern as number | number[]);
  } catch {
    // Some browsers throw without a recent tap; a missing buzz is not an error.
  }
}

/** How far across the button (as a share of its width) the wheels keep shedding dust. */
const DUST_STOPS_AT = 0.7;

/** No travel at all: the state simply changes. */
const INSTANT = { duration: 0 };

/** The truck's speed lines run with the drive itself. */
const DRIVE = { delay: SHIP_TIMING.windup, duration: SHIP_TIMING.drive, ease: FLOOR_IT };

export function ShipConfirmButton({
  state,
  label,
  deliveredLabel,
}: {
  state: ShipState;
  /** The button's words: what pressing it does. */
  label: ReactNode;
  /** What the wash says once it has landed. */
  deliveredLabel: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const truckRef = useRef<HTMLSpanElement>(null);
  const dustRef = useRef<HTMLSpanElement>(null);
  const geometry = useRef<Geometry>(NO_GEOMETRY);
  const truckX = useMotionValue(0);
  // useId gives ":r1:", which url(#...) cannot take without escaping.
  const gooId = `ship-goo-${useId().replace(/:/g, "")}`;
  const cloud = useTransform(truckX, (x) => cloudPath(x, geometry.current, GOO_MARGIN));
  const textCone = useTransform(truckX, (x) => coneClip(x, geometry.current, 0, TEXT_LAG));
  // Only while the cloud is actually moving: once the colour has covered the
  // button the filter has nothing left to shape, so it is dropped.
  const goo = useTransform(truckX, (x) =>
    x > 0 && x < geometry.current.total ? `url(#${gooId})` : "none",
  );
  const slide = useTransform(truckX, (x) => -SLIDE_PX * (1 - journey(x, geometry.current)));
  const working = state === "working";
  const delivered = state === "delivered";
  const idle = state === "idle";
  const travelling = delivered && !reducedMotion;
  const roll = SHIP_TIMING.windup + SHIP_TIMING.drive;

  useEffect(() => {
    const button = buttonRef.current;
    const truck = truckRef.current;
    if (!travelling || !button || !truck) return;
    // Layout sizes, not bounding rects: those would include the press scale.
    const height = button.offsetHeight;
    const coneLength = height * CONE_LENGTH;
    // Far enough that the van has left and even the lagging text cone has cleared.
    const total = button.offsetWidth - truck.offsetLeft + coneLength + TEXT_LAG;
    geometry.current = {
      height,
      rest: truck.offsetLeft + truck.offsetWidth / 2,
      total,
      cone: coneLength,
    };
    const controls = animate(truckX, [0, -WINDUP_PX, total], {
      duration: roll,
      times: [0, SHIP_TIMING.windup / roll, 1],
      ease: ["easeOut", FLOOR_IT],
    });
    const launch = setTimeout(() => vibrate(HAPTIC.launch), ms(SHIP_TIMING.windup));
    const land = setTimeout(() => vibrate(HAPTIC.land), ms(roll));
    return () => {
      controls.stop();
      clearTimeout(launch);
      clearTimeout(land);
    };
  }, [travelling, roll, truckX]);

  // Dust off the wheels: a thin spray while the van revs on the spot, thicker
  // and further back as it gathers speed, and a burst as it lets go. Specks
  // stay where they are kicked, so the van leaves a trail.
  useEffect(() => {
    const layer = dustRef.current;
    const truck = truckRef.current;
    if (!layer || !truck || reducedMotion || !(working || travelling)) return;
    const kick = (speed: number, count: number) => {
      const x = truckX.get();
      for (const wheel of TRUCK_WHEELS) {
        const at = {
          x: truck.offsetLeft + x + wheel.x * truck.offsetWidth,
          y: truck.offsetTop + wheel.y * truck.offsetHeight,
        };
        // Nearly at the far edge is where the dust stops: anything kicked up
        // later would be left glittering over the finished "Shipped".
        if (at.x > layer.clientWidth * DUST_STOPS_AT) continue;
        for (let i = 0; i < count; i++) kickDust(layer, at, speed);
      }
    };
    const spray = setInterval(() => {
      if (travelling) {
        const speed = journey(truckX.get(), geometry.current);
        kick(speed, 1 + Math.round(speed * 3));
      } else if (Math.random() < 0.7) {
        kick(0, 1);
      }
    }, DUST.everyMs);
    const burst = travelling ? setTimeout(() => kick(0.5, 6), ms(SHIP_TIMING.windup)) : undefined;
    return () => {
      clearInterval(spray);
      if (burst) clearTimeout(burst);
    };
  }, [working, travelling, reducedMotion, truckX]);

  return (
    <span className={cn("relative flex", shipMainActionClass)}>
      <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute size-0">
        <filter id={gooId} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation={GOO_BLUR} result="blur" />
          <feColorMatrix in="blur" type="matrix" values={`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  ${GOO_ALPHA}`} />
        </filter>
      </svg>
      <motion.button
        ref={buttonRef}
        type="submit"
        data-ship={state}
        aria-disabled={!idle || undefined}
        aria-busy={working || undefined}
        className={buttonClassName(
          "primary",
          cn("relative isolate w-full overflow-hidden", !idle && "pointer-events-none"),
        )}
        // Sinks under the finger; POP springs it back with a little bounce.
        whileTap={idle && !reducedMotion ? { scale: PRESS_SCALE } : undefined}
        transition={POP}
        animate={
          travelling
            ? {
                scale: [1, LAND_POP_SCALE, 1],
                transition: { delay: roll - 0.04, duration: LAND_POP_SECONDS, ease: "easeInOut" },
              }
            : { scale: 1 }
        }
      >
        <motion.span
          ref={truckRef}
          style={{ x: truckX }}
          className="relative z-20 inline-flex group-data-[ship=delivered]/btn:motion-reduce:invisible"
        >
          {working && reducedMotion ? <Spinner className="size-4" /> : <TruckIcon driving={working} />}
          {/* Speed lines trailing the truck: they lengthen as it gathers speed. */}
          <motion.span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-full flex origin-right flex-col items-end justify-center gap-1"
            initial={false}
            // In as the truck gathers speed, out again before it has quite left,
            // so no lines are left hanging at the edge once it has gone. Evenly
            // spaced keyframes: a custom `times` would desync the fade from the stretch.
            animate={travelling ? { opacity: [0, 1, 1, 0], scaleX: 1 } : { opacity: 0, scaleX: 0.25 }}
            transition={travelling ? { opacity: { ...DRIVE, ease: "linear" }, scaleX: DRIVE } : INSTANT}
          >
            <span className="h-px w-2 bg-current" />
            <span className="h-px w-3 bg-current" />
            <span className="h-px w-1.5 bg-current" />
          </motion.span>
        </motion.span>

        {/* Dust off the wheels (ship-dust). Specks are added here directly. */}
        <span ref={dustRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-20" />

        {/* Clears the road as the truck winds up, so it never drives over its own words. */}
        <motion.span
          initial={false}
          animate={{ opacity: travelling ? 0 : 1 }}
          transition={travelling ? { delay: SHIP_TIMING.windup / 2, duration: DURATION.base } : INSTANT}
        >
          {label}
        </motion.span>

        {/* The colour itself. Under the truck (z-10 against its z-20), so the
            cloud's tip is hidden by the van and the colour seems to come from
            behind it. Drawn larger than the button and run through the gooey
            filter, which melts the discs into one body. */}
        <motion.span
          aria-hidden="true"
          className={cn("absolute z-10", reducedMotion && delivered && "bg-success dark:bg-success-dark")}
          style={{ inset: -GOO_MARGIN, filter: reducedMotion ? "none" : goo }}
        >
          {!reducedMotion && (
            <svg className="absolute inset-0 size-full text-success dark:text-success-dark" fill="currentColor">
              <motion.path d={cloud} />
            </svg>
          )}
        </motion.span>

        {/* The words, on a plain cone that trails the coloured one (see TEXT_LAG). */}
        <motion.span
          aria-hidden="true"
          className="absolute inset-0 z-10 text-background"
          style={{ clipPath: reducedMotion ? (delivered ? CLIP_OPEN : CLIP_SHUT) : textCone }}
        >
          <motion.span
            className="flex size-full items-center justify-center gap-2"
            style={{ x: reducedMotion ? 0 : slide }}
          >
            <svg
              viewBox="0 0 24 24"
              className="size-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {/* Opacity gates the draw: a zero-length round-capped path still paints a dot. */}
              <motion.path
                d="M5 13l4 4L19 7"
                initial={false}
                animate={delivered ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
                transition={
                  travelling
                    ? {
                        delay: SHIP_TIMING.windup + SHIP_TIMING.drive * 0.75,
                        duration: SHIP_TIMING.check,
                        ease: "easeOut",
                      }
                    : INSTANT
                }
              />
            </svg>
            <span>{deliveredLabel}</span>
          </motion.span>
        </motion.span>
      </motion.button>
    </span>
  );
}
