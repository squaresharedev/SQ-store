"use client";

import * as React from "react";
import { useLocale } from "next-intl";

import type { Locale } from "@/i18n/locales";
import { numberFormat } from "@/lib/format/intl";
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
 * are rebuilt in the reader's locale, preserving each run's decimal
 * count and whether it was grouped, so the digits never jitter in width for
 * the wrong reason.
 *
 * Reduced motion skips straight to the final value.
 */

/**
 * How numbers look in one locale: the pattern of a numeric run (digits,
 * optional group separators, optional decimal tail) and the tag to rebuild
 * frames with. English is en-IE-shaped, mirroring lib/format's English price
 * locale; other locales read their own separators ("1 234,50" in Czech).
 */
type NumberShape = { run: RegExp; group: string; decimal: string; tag: string };

const ENGLISH_SHAPE: NumberShape = {
  run: /\d[\d,]*(?:\.\d+)?/g,
  group: ",",
  decimal: ".",
  tag: "en-IE",
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function numberShape(locale: Locale): NumberShape {
  if (locale === "en") return ENGLISH_SHAPE;
  const parts = numberFormat(locale).formatToParts(1234567.8);
  const group = parts.find((part) => part.type === "group")?.value ?? ",";
  const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
  // A group separator only counts between digits, so the space before "€" or
  // "%" in "12,50 €" stays outside the run.
  const run = new RegExp(
    `\\d(?:\\d|${escapeRegExp(group)}(?=\\d))*(?:${escapeRegExp(decimal)}\\d+)?`,
    "g",
  );
  return { run, group, decimal, tag: locale };
}

type Run = { raw: string; value: number; decimals: number; grouped: boolean };

function parseRuns(text: string, shape: NumberShape): Run[] {
  return Array.from(text.matchAll(shape.run), (match) => {
    const raw = match[0];
    const dot = raw.indexOf(shape.decimal);
    return {
      raw,
      value: Number(raw.split(shape.group).join("").replace(shape.decimal, ".")),
      decimals: dot === -1 ? 0 : raw.length - dot - shape.decimal.length,
      grouped: raw.includes(shape.group),
    };
  });
}

function formatRun(value: number, run: Run, shape: NumberShape): string {
  return numberFormat(shape.tag, {
    minimumFractionDigits: run.decimals,
    maximumFractionDigits: run.decimals,
    useGrouping: run.grouped,
  }).format(value);
}

/** Rebuild the string with every numeric run scaled to `progress`. */
function frameAt(text: string, runs: Run[], progress: number, shape: NumberShape): string {
  let index = 0;
  return text.replace(shape.run, () => {
    const run = runs[index];
    index += 1;
    return run ? formatRun(run.value * progress, run, shape) : "";
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
  const locale = useLocale();

  useIsomorphicLayoutEffect(() => {
    const shape = numberShape(locale);
    const runs = parseRuns(value, shape);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || runs.length === 0) {
      setDisplay(value);
      return;
    }

    const duration = countUpDurationMs();
    let frame = 0;
    let start: number | null = null;

    setDisplay(frameAt(value, runs, 0, shape));

    function step(now: number) {
      start ??= now;
      const t = Math.min(1, (now - start) / duration);
      // Land on the original string exactly, never a re-formatted lookalike.
      setDisplay(t >= 1 ? value : frameAt(value, runs, easeOut(t), shape));
      if (t < 1) frame = requestAnimationFrame(step);
    }

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, locale]);

  // Announce only the settled figure: a live count would spam assistive tech.
  //
  // A visually hidden text node, NOT aria-label on the wrapper: aria-label is
  // prohibited on a generic element (a span with no role) and is widely ignored
  // by screen readers there, so the figure risked being announced as nothing at
  // all. Real text is read reliably and needs no role invented for it.
  return (
    <span className={className}>
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
