"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { RadialLightRays } from "@/components/ui/RadialLightRays";
import {
  CELEBRATION_ORIGIN,
  confettiPalette,
  createConfetti,
  drawConfetti,
  framesBetween,
  stepConfetti,
} from "./confetti";

/**
 * THE MOMENT AN ORDER LANDS, on the thank-you page, in the seller's choice
 * (checkoutPage.celebrate): confetti, or a soft burst of light. Played once,
 * and never in the way: nothing here takes a pointer or says anything to a
 * screen reader.
 *
 * Only on the visit straight after paying (the order page passes `play` from
 * `?placed=1`); the same page opened from the email days later is a status
 * page and opens quietly. Reduced motion gets neither; the still check mark
 * carries the news.
 */

/** The check mark pops first; the confetti bursts out of it a beat later. */
const CONFETTI_START_MS = 160;

/**
 * Confetti over the whole screen, bursting from the check mark (see
 * confetti.ts for how it moves and what colours it takes).
 *
 * For a buyer it is a fixed layer over the viewport, so the pieces fall
 * across the whole phone or monitor rather than one column. In the editor
 * (`contained`) a fixed layer would cover the seller's screen, so it fills the
 * nearest positioned ancestor instead: the thank-you page on its artboard.
 */
export function CelebrationConfetti({
  play,
  contained,
  accent,
  button,
  surface,
}: {
  play: boolean;
  contained: boolean;
  /** The storefront accent, the pay button's fill, and the page they fall over. */
  accent: string;
  button: string;
  surface: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!play || !canvas) return;
    // Where the burst is, for tests and agents: written straight onto the
    // layer, since nothing on screen depends on it and a re-render per phase
    // would be for nothing.
    const layer = canvas.parentElement;
    const setState = (state: "playing" | "done") => {
      if (layer) layer.dataset.celebrationState = state;
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setState("done");
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) return;

    // Layout pixels (a scaled artboard reports its SCALED box to
    // getBoundingClientRect, so screen positions are mapped back).
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const box = canvas.getBoundingClientRect();
    const toCanvas = box.width > 0 ? width / box.width : 1;
    // A contained layer can be a whole page tall; one pixel per pixel there.
    const ratio = contained ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const mark = canvas.parentElement?.parentElement?.querySelector(`[${CELEBRATION_ORIGIN}]`);
    const markBox = mark?.getBoundingClientRect();
    const origin = markBox
      ? {
          x: (markBox.left + markBox.width / 2 - box.left) * toCanvas,
          y: (markBox.top + markBox.height / 2 - box.top) * toCanvas,
        }
      : { x: width / 2, y: Math.min(height * 0.25, 240) };

    const pieces = createConfetti({
      width,
      height,
      origin,
      colors: confettiPalette({ accent, button, surface }),
    });

    let frame = 0;
    const start = performance.now() + CONFETTI_START_MS;
    let last = start;
    const tick = (now: number) => {
      if (now < start) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const alive = stepConfetti(pieces, framesBetween(last, now), height);
      last = now;
      context.clearRect(0, 0, width, height);
      drawConfetti(context, pieces);
      if (alive) frame = requestAnimationFrame(tick);
      else setState("done");
    };
    setState("playing");
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [play, contained, accent, button, surface]);

  if (!play) return null;
  return (
    <div
      className={cn("pointer-events-none inset-0 z-30", contained ? "absolute" : "fixed")}
      aria-hidden="true"
      data-celebration="confetti"
      data-celebration-state="waiting"
    >
      <canvas ref={ref} className="size-full" />
    </div>
  );
}

/** A soft burst of light in the storefront's accent, behind the heading. */
export function CelebrationRays({ play, accent }: { play: boolean; accent: string }) {
  if (!play) return null;
  return (
    <div
      className="pointer-events-none absolute inset-0 -z-10 opacity-70 motion-reduce:hidden"
      aria-hidden="true"
      data-celebration="rays"
    >
      <RadialLightRays color={accent} intensity={0.8} className="size-full" />
    </div>
  );
}
