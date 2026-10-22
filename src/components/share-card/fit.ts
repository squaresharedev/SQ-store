"use client";

import { useEffect, useState } from "react";

/**
 * Big type set to FILL a width: each line of a share card's headline at the
 * size that runs it edge to edge (FitText only ever shrinks). Measured in a
 * canvas in the display face (font-display), once the face has loaded; until
 * then, and on the server, an estimate from the character count stands in.
 */

/** A capital in the display face is about this wide, in em, for the estimate. */
const ESTIMATE_EM = 0.62;

/** The size every line is measured at; any size scales from it. */
const MEASURE_PX = 100;

let family: string | null = null;
let canvas: HTMLCanvasElement | null = null;

/** The display face's real font-family list (next/font names it), read off
 *  an element styled the way the cards style their type. */
function displayFamily(): string {
  if (family) return family;
  const probe = document.createElement("span");
  probe.className = "font-display";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  document.body.append(probe);
  family = getComputedStyle(probe).fontFamily;
  probe.remove();
  return family;
}

export type FitOptions = {
  /** The width to fill, in CSS pixels. */
  width: number;
  /** The most any line may grow to, in CSS pixels: a one-word line would
   *  otherwise be taller than the card. */
  max: number;
  min?: number;
  weight?: number;
  /** The letter-spacing the type is set with, in em (tracking-tighter is -0.05). */
  tracking?: number;
};

/** The font size (px) for each line of `text` (lines split on "\n"). */
export function useFittedSizes(
  text: string,
  { width, max, min = 12, weight = 700, tracking = 0 }: FitOptions,
): number[] {
  const key = `${text}|${width}|${max}|${min}|${weight}|${tracking}`;
  const [measured, setMeasured] = useState<{ key: string; sizes: number[] } | null>(null);

  useEffect(() => {
    let live = true;
    const lines = text.split("\n");
    const font = `${weight} ${MEASURE_PX}px ${displayFamily()}`;
    void document.fonts.load(font, text).then(() => {
      canvas ??= document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context || !live) return;
      context.font = font;
      const sizes = lines.map((line) => {
        const atMeasure = context.measureText(line).width + tracking * MEASURE_PX * line.length;
        return clamp((width / atMeasure) * MEASURE_PX, min, max);
      });
      setMeasured({ key, sizes });
    });
    return () => {
      live = false;
    };
  }, [key, text, width, max, min, weight, tracking]);

  if (measured?.key === key) return measured.sizes;
  return text
    .split("\n")
    .map((line) => clamp(width / (Math.max(1, line.length) * (ESTIMATE_EM + tracking)), min, max));
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n * 10) / 10));
}
