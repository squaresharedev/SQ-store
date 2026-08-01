"use client";

import * as React from "react";

import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";

/**
 * Counts a PRE-FORMATTED figure up from zero on mount (and between values on
 * update), without the caller having to hand over raw numbers.
 *
 * Why parse the string instead of taking a number: the dashboard's figures are
 * formatted server-side and are not always one number — `formatMoney` joins
 * multiple currencies ("€100.00 · $50.00"). Scaling every numeric run in the
 * string handles that, plain counts, and percentages with one code path.
 *
 * The end state is the ORIGINAL string, returned verbatim, so whatever the
 * server rendered is exactly what the animation lands on. Intermediate frames
 * are rebuilt with the app's display locale, preserving each run's decimal
 * count and whether it was grouped, so the digits never jitter in width for
 * the wrong reason.
 *
 * Reduced motion skips straight to the final value.
 */

/** Matches an en-IE-shaped numeric run: digits, optional thousands commas,
 *  optional decimal tail. Mirrors lib/format's PRICE_LOCALE. */
const NUMERIC_RUN = /\d[\d,]*(?:\.\d+)?/g;
const DISPLAY_LOCALE = "en-IE";

type Run = { raw: string; value: number; decimals: number; grouped: boolean };

function parseRuns(text: string): Run[] {
  return Array.from(text.matchAll(NUMERIC_RUN), (match) => {
    const raw = match[0];
    const dot = raw.indexOf(".");
    return {
      raw,
      value: Number(raw.replace(/,/g, "")),
      decimals: dot === -1 ? 0 : raw.length - dot - 1,
      grouped: raw.includes(","),
    };
  });
}

function formatRun(value: number, run: Run): string {
  return new Intl.NumberFormat(DISPLAY_LOCALE, {
    minimumFractionDigits: run.decimals,
    maximumFractionDigits: run.decimals,
    useGrouping: run.grouped,
  }).format(value);
}

/** Rebuild the string with every numeric run scaled to `progress`. */
function frameAt(text: string, runs: Run[], progress: number): string {
  let index = 0;
  return text.replace(NUMERIC_RUN, () => {
    const run = runs[index];
    index += 1;
    return run ? formatRun(run.value * progress, run) : "";
  });
}

/** Decelerating curve, matching the character of the --ease-entrance token. */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** Count-up duration, read once from the design token in globals.css. */
let cachedDurationMs: number | null = null;
function countUpDurationMs(): number {
  if (cachedDurationMs !== null) return cachedDurationMs;
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--duration-countup")
    .trim();
  const parsed = raw.endsWith("ms")
    ? Number.parseFloat(raw)
    : raw.endsWith("s")
      ? Number.parseFloat(raw) * 1000
      : Number.NaN;
  cachedDurationMs = Number.isFinite(parsed) ? parsed : 900;
  return cachedDurationMs;
}

export function CountUp({
  value,
  className,
}: {
  /** The final, already-formatted figure. Rendered verbatim when settled. */
  value: string;
  className?: string;
}) {
  // Start settled so the server render and the hydrated markup agree; the
  // layout effect rewinds to zero before the first paint, so the final figure
  // is never briefly shown and then snapped back.
  const [display, setDisplay] = React.useState(value);

  useIsomorphicLayoutEffect(() => {
    const runs = parseRuns(value);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || runs.length === 0) {
      setDisplay(value);
      return;
    }

    const duration = countUpDurationMs();
    let frame = 0;
    let start: number | null = null;

    setDisplay(frameAt(value, runs, 0));

    function step(now: number) {
      start ??= now;
      const t = Math.min(1, (now - start) / duration);
      // Land on the original string exactly, never a re-formatted lookalike.
      setDisplay(t >= 1 ? value : frameAt(value, runs, easeOut(t)));
      if (t < 1) frame = requestAnimationFrame(step);
    }

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  // Announce only the settled figure: a live count would spam assistive tech.
  return (
    <span className={className} aria-label={value}>
      <span aria-hidden="true">{display}</span>
    </span>
  );
}
