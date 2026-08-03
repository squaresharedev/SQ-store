"use client";

import { useCallback, useRef, useState } from "react";
import { useIsomorphicLayoutEffect } from "@/lib/hooks/useIsomorphicLayoutEffect";

/**
 * Scale factor that makes `content` fit entirely inside `box`.
 *
 * Returns 1 when it already fits, and the largest factor below 1 that makes it
 * fit when it doesn't — so content is only ever shrunk, never blown up. Both
 * axes are considered and the smaller factor wins, which is what keeps the
 * aspect ratio intact.
 */
export function fitScale(
  box: { width: number; height: number },
  content: { width: number; height: number },
): number {
  // Nothing measured yet (or a collapsed box): assume it fits rather than
  // scaling to zero and flashing an invisible preview.
  if (box.width <= 0 || box.height <= 0) return 1;
  if (content.width <= 0 || content.height <= 0) return 1;
  return Math.min(1, box.width / content.width, box.height / content.height);
}

/**
 * Measure a box and its content, and report the scale that fits one inside the
 * other.
 *
 * Uses a CSS transform rather than shrinking the layout: transforms do not
 * affect layout, so the content keeps reporting its NATURAL size and the
 * measurement can never chase its own tail. Scaling by layout (e.g. reducing a
 * font size or a cell size) would re-flow the content, produce a new
 * measurement, and oscillate.
 *
 * Re-measures on resize of either element, so a card in a responsive grid
 * stays correct across breakpoints without a re-mount.
 */
export function useFitToBox() {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    // scrollHeight, not offsetHeight: the content's own children may overflow
    // it (a grid taller than its declared rows), and the preview has to fit
    // what is actually drawn.
    const next = fitScale(
      { width: box.clientWidth, height: box.clientHeight },
      { width: content.offsetWidth, height: content.scrollHeight },
    );
    // Guard the state write so a no-op measurement can't trigger a render.
    setScale((current) => (Math.abs(current - next) < 0.001 ? current : next));
  }, []);

  useIsomorphicLayoutEffect(() => {
    measure();
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(content);
    return () => observer.disconnect();
  }, [measure]);

  return { boxRef, contentRef, scale, remeasure: measure };
}
