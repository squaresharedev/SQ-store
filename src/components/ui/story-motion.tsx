"use client";

import { useEffect, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { MousePointer2, Pause, Play } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { iconButtonClass } from "./control-styles";
import { EASE_STANDARD, POP, PRESS_SCALE } from "./motion-tokens";

/**
 * THE PARTS OF A DRAWN MOTION STORY: a picture of our own UI in which a cursor
 * clicks through what a feature does, in place of a paragraph about it (the buy
 * button dialog, the product form's add to order). A story is a module-level
 * array of beats; `beats` only counts up, and each part animates to its beat.
 */

/** The cursor crossing the stage: slower than a state change, it is travel. */
const GLIDE = { duration: 0.7, ease: EASE_STANDARD };
/** The ring a click leaves behind. */
const RIPPLE = { duration: 0.45, ease: EASE_STANDARD };
/** The pointer's tip sits this far inside its own box (px), so the TIP lands on the target. */
const CURSOR_TIP = 3;
/** Where on a button the cursor clicks, as a fraction of the button: right of
 *  and below its centre, so the pointer never covers the label. */
const AIM = { x: 0.78, y: 0.8 };

export type StoryPoint = { x: number; y: number };

/** The point on `node` the cursor clicks, in `root`'s coordinates. Offsets, not
 *  bounding rects: a dialog arrives with a transform, and a screen waits below
 *  its place. */
export function aimWithin(node: HTMLElement, root: HTMLElement): StoryPoint {
  let x = node.offsetWidth * AIM.x;
  let y = node.offsetHeight * AIM.y;
  for (let el: HTMLElement | null = node; el && el !== root; el = el.offsetParent as HTMLElement | null) {
    x += el.offsetLeft;
    y += el.offsetTop;
  }
  return { x, y };
}

/** The beat the cursor last pressed on, or null before its first click. It keys
 *  the click's ring, so each click draws a fresh one that plays out in full
 *  however short the press itself is. */
function lastClick(story: readonly { press: boolean }[], beats: number): number | null {
  for (let played = beats; played >= 0; played--) {
    if (story[played % story.length].press) return played;
  }
  return null;
}

/**
 * Plays a story `loops` times and then rests on its first frame: a story sits
 * beside something the seller came to do, so it must not move forever. Under
 * reduced motion it never starts by itself. While `active` is false the frame
 * simply holds.
 */
export function useStoryBeats<Beat extends { ms: number }>(
  story: readonly Beat[],
  loops: number,
  active: boolean,
) {
  const prefersStill = useReducedMotion();
  const [playing, setPlaying] = useState(!prefersStill);
  // Beats played so far; the beat on screen is its remainder. It only ever
  // counts up, so a pause holds the frame, a finished story rests on the first
  // frame of the next loop, and the beat before is always known.
  const [beats, setBeats] = useState(0);
  const running = playing && active;
  const beat = story[beats % story.length];

  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => {
      const played = beats + 1;
      setBeats(played);
      if (played % (story.length * loops) === 0) setPlaying(false);
    }, beat.ms);
    return () => window.clearTimeout(id);
  }, [running, beats, beat.ms, story.length, loops]);

  return { beats, beat, playing, running, setPlaying };
}

/** A button in the picture that sinks while the cursor is pressing it. */
export function StoryButton({
  pressed,
  buttonRef,
  className,
  children,
}: {
  pressed: boolean;
  buttonRef: RefObject<HTMLSpanElement | null>;
  className: string;
  children: ReactNode;
}) {
  return (
    <motion.span
      ref={buttonRef}
      className={cn("inline-flex items-center justify-center font-inter text-xs font-medium", className)}
      initial={false}
      animate={{ scale: pressed ? PRESS_SCALE : 1 }}
      transition={POP}
    >
      {children}
    </motion.span>
  );
}

/** The cursor, and the ring its click leaves. Draw it once `aim` is known. */
export function StoryCursor({
  aim,
  story,
  beats,
}: {
  aim: StoryPoint;
  story: readonly { press: boolean }[];
  beats: number;
}) {
  const click = lastClick(story, beats);
  return (
    <motion.span
      className="pointer-events-none absolute left-0 top-0"
      initial={false}
      animate={{ x: aim.x - CURSOR_TIP, y: aim.y - CURSOR_TIP }}
      transition={GLIDE}
    >
      {click !== null && (
        <motion.span
          key={click}
          className="absolute -left-2 -top-2 size-6 rounded-full border border-foreground"
          initial={{ scale: 0.3, opacity: 0.6 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={RIPPLE}
        />
      )}
      <MousePointer2 className="relative size-5 fill-foreground stroke-background drop-shadow-sm" strokeWidth={1.5} />
    </motion.span>
  );
}

/** The play/pause control, in the top corner of a story's drawn browser bar. */
export function StoryPlayToggle({
  playing,
  label,
  className,
  ...button
}: { playing: boolean; label: string } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(iconButtonClass, "absolute right-2 top-1.5 size-6 border-0 bg-transparent", className)}
      {...button}
    >
      {playing ? (
        <Pause className="size-3.5" strokeWidth={2} aria-hidden="true" />
      ) : (
        <Play className="size-3.5" strokeWidth={2} aria-hidden="true" />
      )}
    </button>
  );
}
